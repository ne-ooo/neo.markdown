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
  /** Whether a rule has returned a token with children in this document, so there are measures to read. */
  custom: boolean
  /** The custom text in the alt text of each image built here and still kept. */
  readonly images: WeakMap<object, number>
  /**
   * The descendants of kept custom tokens, without a token budget, where the
   * token budget counts them: up to the output limit.
   */
  readonly nodes: TokenBudget | undefined
  /**
   * The custom text in kept images' alt text, up to the output limit. Alt
   * text from the Markdown itself is bounded by the Markdown.
   */
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
  if (typeof value === 'string') return value
  return value == null ? '' : String(value)
}

function childrenOf(token: InlineToken): InlineToken[] | undefined {
  if (!('tokens' in token)) return undefined
  const children: unknown = token.tokens
  if (!Array.isArray(children)) throw new TypeError('Inline token children must be an array')
  return children as InlineToken[]
}

function checkChild(child: unknown): asserts child is InlineToken {
  if (typeof child !== 'object' || child === null) throw new TypeError('Inline token children must be tokens')
}

// Thrown through the recursive measure when a token is deeper than the
// renderer renders, or holds itself.
const TOO_DEEP = Symbol('too deep')

/**
 * Arrays of children at least this long are measured once per document,
 * however many tokens hold them: a rule may wrap one array in a new token
 * each time.
 */
const SHARED_CHILDREN_LENGTH = 16

/** The measure of an array of tokens without children. */
function leavesMeasure(children: InlineToken[]): InlineTokenMeasure {
  let text = 0, link = false
  for (const child of children) {
    text += leafText(child).length
    link ||= (child as { type: string }).type === 'link'
  }
  return { nodes: children.length, text, depth: children.length > 0 ? 1 : 0, link }
}

/**
 * Whether every child is a token without children. A token holding only
 * such children can't share a token or hold itself, so it counts and reads
 * as a built-in one does, and isn't measured.
 */
function onlyLeaves(children: InlineToken[], measures: WeakMap<object, InlineTokenMeasure>): boolean {
  const long = children.length >= SHARED_CHILDREN_LENGTH
  const held = long ? measures.get(children) : undefined
  if (held) return held.depth <= 1
  for (const child of children) {
    checkChild(child)
    if ('tokens' in child) return false
  }
  if (long) measures.set(children, leavesMeasure(children))
  return true
}

/**
 * Measures a token with children. Tokens shared within it are measured once,
 * through `local`. The document keeps the measures of long arrays of
 * children, and of tokens holding tokens that give no alt text, so alt text
 * can skip them.
 */
function measureWithin(
  token: InlineToken,
  children: InlineToken[],
  measures: WeakMap<object, InlineTokenMeasure>,
  local: Map<object, InlineTokenMeasure>,
  depth: number,
): InlineTokenMeasure {
  if (depth > MAX_TOKEN_DEPTH) throw TOO_DEEP
  const shared = children.length >= SHARED_CHILDREN_LENGTH
  let held = shared ? measures.get(children) : undefined
  if (held) {
    // Its deepest token with children is one above its deepest token.
    if (depth + held.depth - 1 > MAX_TOKEN_DEPTH) throw TOO_DEEP
  } else {
    let nodes = children.length, text = 0, deepest = 0, link = false
    for (const child of children) {
      checkChild(child)
      if (!('tokens' in child)) {
        text += leafText(child).length
        deepest = Math.max(deepest, 1)
        link ||= (child as { type: string }).type === 'link'
        continue
      }
      const childMeasure = measures.get(child) ?? local.get(child)
        ?? measureWithin(child, childrenOf(child)!, measures, local, depth + 1)
      nodes += childMeasure.nodes
      text += childMeasure.text
      deepest = Math.max(deepest, childMeasure.depth + 1)
      link ||= childMeasure.link
    }
    held = { nodes, text, depth: deepest, link }
    if (shared) measures.set(children, held)
  }
  const measure = token.type === 'link' && !held.link ? { ...held, link: true } : held
  local.set(token, measure)
  // A token whose children are all text is charged and released as a
  // built-in one, wherever it is, so it isn't kept.
  if (measure.text === 0 && measure.depth > 1) measures.set(token, measure)
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
      checkChild(child)
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
 * Measures a token with children a custom rule returned, in time
 * proportional to the distinct tokens it holds that `measures` doesn't have
 * yet, and adds their measures to it. A token that holds itself is refused,
 * as rendering it would be, and so is one deeper than the renderer renders.
 */
export function measureCustomToken(token: InlineToken, measures: WeakMap<object, InlineTokenMeasure>): InlineTokenMeasure {
  const known = measures.get(token)
  if (known) return known
  let measure: InlineTokenMeasure
  try {
    measure = measureWithin(token, childrenOf(token)!, measures, new Map(), 0)
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
 * kept, against the token budget, or the document's own without one. A token
 * whose children have none counts as a built-in one does. The caller
 * charges the token itself.
 */
export function chargeCustomToken(token: InlineToken, document: InlineDocument, budget: TokenBudget | undefined): void {
  const children = childrenOf(token)
  // Without a limit nothing counts descendants, as without rules; the
  // renderer still refuses a token that holds itself or is too deep.
  if (!children || (!budget && !document.nodes)) return
  // A token already measured, as one in another rule's token, is released
  // by its measure, so it is charged by it too.
  const known = document.measures.get(token)
  if (!known && onlyLeaves(children, document.measures)) {
    if (budget) consumeTokenBudget(budget, children.length)
    return
  }
  const measure = known ?? measureCustomToken(token, document.measures)
  document.custom = true
  if (budget) consumeTokenBudget(budget, measure.nodes)
  else keepNodes(document, measure.nodes)
}

/** Counts custom text an image's alt text keeps, refusing past the output limit. */
export function keepAltText(document: InlineDocument, length: number): void {
  if (length > document.maxAltText - document.altText) {
    throw new RangeError(`Custom text in image alt text exceeds ${document.outputLimit}`)
  }
  document.altText += length
}

/**
 * A token whose text can be changed: a copy of a plain object, which a rule
 * may return every time, or the token itself otherwise. A class instance is
 * changed in place, as before, since no copy keeps its private fields.
 */
export function editableText<T extends object>(token: T): T {
  const prototype: unknown = Object.getPrototypeOf(token)
  return prototype === Object.prototype || prototype === null ? { ...token } : token
}

/** Pieces at least this long are shared by an alt text rather than copied into it. */
export const SHARED_PIECE_LENGTH = 256

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
