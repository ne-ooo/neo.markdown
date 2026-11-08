/**
 * Accounting for the tokens custom inline rules return. A rule may return
 * the same token every time, a token whose children share tokens, or one
 * that holds itself, and a document decides how often the rule runs and
 * where. Each token is measured the first time a rule returns it in a
 * document, counting every path to a shared token as a recursive walk
 * would, so nothing walks those paths again.
 */
import type { InlineToken } from './types.js'
import { consumeTokenBudget, createTokenBudget, type TokenBudget } from './token-budget.js'

/** What a token expands to, counting each path to a shared token. */
export interface InlineTokenMeasure {
  /** Its descendants: its children, their children, and so on. */
  readonly nodes: number
  /** The code units of alt text it gives: its children's, or its own text without children. */
  readonly text: number
  /** 0 without children, else one more than its deepest child. */
  readonly depth: number
  /** Whether it is a link or holds one. */
  readonly link: boolean
}

/**
 * One document's accounting for custom rules' tokens.
 *
 * What the tokens a document keeps expand to, and the alt text of the images
 * it keeps, count while they're kept and return when they're discarded, so
 * link text tokenized again costs nothing more. Copying custom text into alt
 * text is work done each time, and none of it returns.
 */
export interface InlineDocument {
  /**
   * The measures of the tokens rules returned in this document, and of
   * everything they hold, taken the first time each was returned. A plugin
   * may change a token between documents, as a token transform can.
   */
  readonly measures: Map<object, InlineTokenMeasure>
  /** The alt text of custom tokens, built at most once per document. */
  readonly altTexts: Map<object, string>
  /** For each image built here: its alt text's length, and the custom text in it. */
  readonly images: Map<object, { length: number; custom: number }>
  /**
   * The descendants of kept custom tokens, without a token budget, where the
   * token budget counts them: up to the output limit.
   */
  readonly nodes: TokenBudget | undefined
  /** The alt text of kept images, up to the output limit. */
  altText: number
  readonly maxAltText: number
  /** Custom text copied into alt text, up to CUSTOM_COPY_FACTOR times the output limit. */
  copiedText: number
  readonly maxCopiedText: number
  readonly outputLimit: string
}

/**
 * How much custom text a document may copy into alt text, as a multiple of
 * its output limit. Link text is tokenized again when it holds a link, which
 * builds the alt text of the images in it again.
 */
export const CUSTOM_COPY_FACTOR = 4

/** The deepest token the renderer renders, so the deepest a rule may return. */
const MAX_TOKEN_DEPTH = 256

/** The text a token without children gives as alt text, as join would give it. */
export function leafText(token: InlineToken): string {
  if (token.type === 'br') return '\n'
  const value: unknown = (token as { text?: unknown }).text
  return value == null ? '' : String(value)
}

function childrenOf(token: InlineToken): InlineToken[] | undefined {
  if (!('tokens' in token)) return undefined
  const children: unknown = token.tokens
  if (!Array.isArray(children)) throw new TypeError('Inline token children must be an array')
  for (const child of children) {
    if (typeof child !== 'object' || child === null) throw new TypeError('Inline token children must be tokens')
  }
  return children as InlineToken[]
}

// Thrown through the recursive measure when a token is deeper than the
// renderer renders, or holds itself.
const TOO_DEEP = Symbol('too deep')

function leafMeasure(token: InlineToken): InlineTokenMeasure {
  // A plugin's token may be a link without children.
  return { nodes: 0, text: leafText(token).length, depth: 0, link: (token as { type: string }).type === 'link' }
}

function measureWithin(token: InlineToken, measures: Map<object, InlineTokenMeasure>, depth: number): InlineTokenMeasure {
  const known = measures.get(token)
  if (known) return known
  if (depth > MAX_TOKEN_DEPTH) throw TOO_DEEP
  const children = childrenOf(token)
  let measure: InlineTokenMeasure
  if (!children) measure = leafMeasure(token)
  else {
    let nodes = children.length, text = 0, deepest = 0, link = token.type === 'link'
    for (const child of children) {
      const childMeasure = measureWithin(child, measures, depth + 1)
      nodes += childMeasure.nodes
      text += childMeasure.text
      deepest = Math.max(deepest, childMeasure.depth + 1)
      link ||= childMeasure.link
    }
    measure = { nodes, text, depth: deepest, link }
  }
  measures.set(token, measure)
  return measure
}

/** Whether a token holds itself, by a walk that keeps the tokens it is inside. */
function holdsItself(token: InlineToken, measures: Map<object, InlineTokenMeasure>): boolean {
  const open = new Set<object>([token])
  const done = new Set<object>()
  const pending: Array<{ token: InlineToken; next: number }> = [{ token, next: 0 }]
  while (pending.length > 0) {
    const frame = pending[pending.length - 1]!
    const children = childrenOf(frame.token)
    if (children && frame.next < children.length) {
      const child = children[frame.next++]!
      if (open.has(child)) return true
      if (measures.has(child) || done.has(child)) continue
      open.add(child)
      pending.push({ token: child, next: 0 })
      continue
    }
    open.delete(frame.token)
    done.add(frame.token)
    pending.pop()
  }
  return false
}

/**
 * Measures a token a custom rule returned, in time proportional to the
 * distinct tokens it holds that `measures` doesn't have yet, and adds their
 * measures to it. A token that holds itself is refused, as rendering it
 * would be, and so is one deeper than the renderer renders.
 */
export function measureCustomToken(token: InlineToken, measures: Map<object, InlineTokenMeasure>): InlineTokenMeasure {
  try {
    return measureWithin(token, measures, 0)
  } catch (error) {
    if (error !== TOO_DEEP) throw error
    if (holdsItself(token, measures)) throw new TypeError('Cyclic token graph is not renderable')
    throw new RangeError(`Token render depth exceeds ${MAX_TOKEN_DEPTH}`)
  }
}

/** A document's accounting, from its token budget and output limit. */
export function createInlineDocument(budget: TokenBudget | undefined, maxOutputLength: number | undefined): InlineDocument {
  const limit = maxOutputLength ?? Infinity
  return {
    measures: new Map(),
    altTexts: new Map(),
    images: new Map(),
    nodes: !budget && maxOutputLength !== undefined
      ? createTokenBudget(maxOutputLength, 'maxOutputLength')
      : undefined,
    altText: 0,
    maxAltText: limit,
    copiedText: 0,
    maxCopiedText: CUSTOM_COPY_FACTOR * limit,
    outputLimit: `maxOutputLength ${maxOutputLength}`,
  }
}

/**
 * Charges a token a custom rule returned: its descendants count while it's
 * kept, against the token budget, or the document's own without one. The
 * caller charges the token itself.
 */
export function chargeCustomToken(token: InlineToken, document: InlineDocument, budget: TokenBudget | undefined): void {
  const measure = measureCustomToken(token, document.measures)
  if (measure.nodes === 0) return
  if (budget) consumeTokenBudget(budget, measure.nodes)
  else if (document.nodes) {
    if (measure.nodes > document.nodes.remaining) {
      throw new RangeError(`Custom inline tokens' descendants exceed ${document.outputLimit}`)
    }
    document.nodes.remaining -= measure.nodes
  }
}

/** Counts alt text an image keeps, refusing past the output limit. */
export function keepAltText(document: InlineDocument, length: number): void {
  if (length > document.maxAltText - document.altText) {
    throw new RangeError(`Image alt text exceeds ${document.outputLimit}`)
  }
  document.altText += length
}

/** Counts custom text copied into alt text, refusing past CUSTOM_COPY_FACTOR times the output limit. */
export function copyCustomText(document: InlineDocument, length: number): void {
  if (length > document.maxCopiedText - document.copiedText) {
    throw new RangeError(`Custom inline tokens' text copied into alt text exceeds ${CUSTOM_COPY_FACTOR} times ${document.outputLimit}`)
  }
  document.copiedText += length
}

/**
 * The alt text a custom token gives, built once per document from its
 * children's, skipping what gives none. Its length is known from its
 * measure, and the caller has counted it.
 */
export function customAltText(token: InlineToken, document: InlineDocument): string {
  const known = document.altTexts.get(token)
  if (known !== undefined) return known
  const pending: Array<{ token: InlineToken; next: number; pieces: string[] }> = [{ token, next: 0, pieces: [] }]
  let result = ''
  while (pending.length > 0) {
    const frame = pending[pending.length - 1]!
    const children = 'tokens' in frame.token ? frame.token.tokens : undefined
    if (children && frame.next < children.length) {
      const child = children[frame.next++]!
      if (document.measures.get(child)?.text === 0) continue
      const built = document.altTexts.get(child)
      if (built !== undefined) frame.pieces.push(built)
      else if ('tokens' in child) pending.push({ token: child, next: 0, pieces: [] })
      else frame.pieces.push(leafText(child))
      continue
    }
    const text = children ? (frame.pieces.length === 1 ? frame.pieces[0]! : frame.pieces.join('')) : leafText(frame.token)
    document.altTexts.set(frame.token, text)
    pending.pop()
    if (pending.length > 0) pending[pending.length - 1]!.pieces.push(text)
    else result = text
  }
  return result
}

/** What an incremental session records of a paragraph, and spends again when it reuses it. */
export interface InlineDocumentSpent {
  nodes: number
  altText: number
  copiedText: number
}

export function inlineDocumentSpent(document: InlineDocument | undefined): InlineDocumentSpent {
  return {
    nodes: document?.nodes ? document.nodes.limit - document.nodes.remaining : 0,
    altText: document?.altText ?? 0,
    copiedText: document?.copiedText ?? 0,
  }
}

export function respendInlineDocument(document: InlineDocument | undefined, spent: InlineDocumentSpent): void {
  if (!document) return
  if (spent.nodes > 0 && document.nodes) {
    if (spent.nodes > document.nodes.remaining) {
      throw new RangeError(`Custom inline tokens' descendants exceed ${document.outputLimit}`)
    }
    document.nodes.remaining -= spent.nodes
  }
  keepAltText(document, spent.altText)
  copyCustomText(document, spent.copiedText)
}
