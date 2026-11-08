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
 * One document's accounting for custom rules' tokens and images' alt text.
 * What the document keeps counts while it's kept and returns when it's
 * discarded, so link text tokenized again costs nothing more.
 */
export interface InlineDocument {
  /**
   * The measures of the tokens rules returned in this document, and of the
   * tokens in them that give no alt text, taken the first time each was
   * returned. Weak, so discarded tokens aren't kept; per document, so a
   * change a plugin makes between documents, as a token transform can, is
   * seen.
   */
  readonly measures: WeakMap<object, InlineTokenMeasure>
  /** Whether a rule has returned a token in this document, so there are measures to read. */
  custom: boolean
  /** The alt text length of each image built here and still kept. */
  readonly images: WeakMap<object, number>
  /**
   * The descendants of kept custom tokens, without a token budget, where the
   * token budget counts them: up to the output limit.
   */
  readonly nodes: TokenBudget | undefined
  /** The alt text of kept images, up to the output limit. */
  altText: number
  readonly maxAltText: number
  readonly outputLimit: string
}

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

/**
 * Measures a token with children. Tokens shared within it are measured once,
 * through `local`; only those that give no alt text are kept in the
 * document's measures, so alt text can skip them.
 */
function measureWithin(
  token: InlineToken,
  children: InlineToken[],
  measures: WeakMap<object, InlineTokenMeasure>,
  local: Map<object, InlineTokenMeasure>,
  depth: number,
): InlineTokenMeasure {
  if (depth > MAX_TOKEN_DEPTH) throw TOO_DEEP
  let nodes = children.length, text = 0, deepest = 0, link = token.type === 'link'
  for (const child of children) {
    let childMeasure = measures.get(child) ?? local.get(child)
    if (!childMeasure) {
      const grandchildren = childrenOf(child)
      if (!grandchildren) {
        text += leafText(child).length
        deepest = Math.max(deepest, 1)
        link ||= (child as { type: string }).type === 'link'
        continue
      }
      childMeasure = measureWithin(child, grandchildren, measures, local, depth + 1)
    }
    nodes += childMeasure.nodes
    text += childMeasure.text
    deepest = Math.max(deepest, childMeasure.depth + 1)
    link ||= childMeasure.link
  }
  const measure = { nodes, text, depth: deepest, link }
  local.set(token, measure)
  if (text === 0) measures.set(token, measure)
  return measure
}

/** Whether a token holds itself, by a walk that keeps the tokens it is inside. */
function holdsItself(token: InlineToken, measures: WeakMap<object, InlineTokenMeasure>): boolean {
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
export function measureCustomToken(token: InlineToken, measures: WeakMap<object, InlineTokenMeasure>): InlineTokenMeasure {
  const known = measures.get(token)
  if (known) return known
  const children = childrenOf(token)
  let measure: InlineTokenMeasure
  try {
    measure = children ? measureWithin(token, children, measures, new Map(), 0) : leafMeasure(token)
  } catch (error) {
    if (error !== TOO_DEEP) throw error
    if (holdsItself(token, measures)) throw new TypeError('Cyclic token graph is not renderable')
    throw new RangeError(`Token render depth exceeds ${MAX_TOKEN_DEPTH}`)
  }
  measures.set(token, measure)
  return measure
}

/** A document's accounting, from its token budget and output limit. */
export function createInlineDocument(budget: TokenBudget | undefined, maxOutputLength: number | undefined): InlineDocument {
  return {
    measures: new WeakMap(),
    custom: false,
    images: new WeakMap(),
    nodes: !budget && maxOutputLength !== undefined
      ? createTokenBudget(maxOutputLength, 'maxOutputLength')
      : undefined,
    altText: 0,
    maxAltText: maxOutputLength ?? Infinity,
    outputLimit: `maxOutputLength ${maxOutputLength}`,
  }
}

function keepNodes(document: InlineDocument, nodes: number): void {
  const budget = document.nodes
  if (!budget || nodes === 0) return
  if (nodes > budget.remaining) throw new RangeError(`Custom inline tokens' descendants exceed ${document.outputLimit}`)
  budget.remaining -= nodes
}

/**
 * Charges a token a custom rule returned: its descendants count while it's
 * kept, against the token budget, or the document's own without one. The
 * caller charges the token itself.
 */
export function chargeCustomToken(token: InlineToken, document: InlineDocument, budget: TokenBudget | undefined): void {
  const measure = measureCustomToken(token, document.measures)
  document.custom = true
  if (measure.nodes === 0) return
  if (budget) consumeTokenBudget(budget, measure.nodes)
  else keepNodes(document, measure.nodes)
}

/** Counts alt text an image keeps, refusing past the output limit. */
export function keepAltText(document: InlineDocument, length: number): void {
  if (length > document.maxAltText - document.altText) {
    throw new RangeError(`Image alt text exceeds ${document.outputLimit}`)
  }
  document.altText += length
}

/** What an incremental session records of a paragraph, and spends again when it reuses it. */
export interface InlineDocumentSpent {
  nodes: number
  altText: number
}

export function inlineDocumentSpent(document: InlineDocument | undefined): InlineDocumentSpent {
  return {
    nodes: document?.nodes ? document.nodes.limit - document.nodes.remaining : 0,
    altText: document?.altText ?? 0,
  }
}

export function respendInlineDocument(document: InlineDocument | undefined, spent: InlineDocumentSpent): void {
  if (!document) return
  keepNodes(document, spent.nodes)
  keepAltText(document, spent.altText)
}
