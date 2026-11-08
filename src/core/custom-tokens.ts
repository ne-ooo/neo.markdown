/**
 * Accounting for the tokens custom inline rules return. A rule may return
 * the same token every time, a token whose children share tokens, or one
 * that holds itself, and a document decides how often the rule runs. Each
 * token is measured as the rule returns it, counting every path to a shared
 * token as a recursive walk would, and what it expands to is charged to the
 * document.
 */
import type { InlineToken } from './types.js'
import { consumeTokenBudget, type TokenBudget } from './token-budget.js'

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
 * How much custom rules' tokens a document has expanded to, and may, in all.
 * None of it returns, so discarding a token and building it again counts
 * again.
 */
export interface InlineDocument {
  spentNodes: number
  spentText: number
  /**
   * The measures of the tokens rules returned in this document, and of
   * everything they hold, taken the first time each was returned. A plugin
   * may change a token it returns again, as a token transform can after a
   * document, so measures aren't kept between documents.
   */
  readonly measures: WeakMap<object, InlineTokenMeasure>
  readonly maxNodes: number
  readonly maxText: number
  readonly nodeLimit: string
  readonly textLimit: string
}

/**
 * How many descendants of custom tokens a document may count, as a multiple
 * of its token limit, or of its output limit without one.
 */
export const CUSTOM_NODES_FACTOR = 4

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

/**
 * Measures a token a custom rule returned, in time proportional to the
 * distinct tokens it holds that `measures` doesn't have yet, and adds their
 * measures to it. A token that holds itself is refused, as rendering it
 * would be.
 */
export function measureCustomToken(token: InlineToken, measures: WeakMap<object, InlineTokenMeasure>): InlineTokenMeasure {
  const known = measures.get(token)
  if (known) return known
  const open = new Set<object>()
  const pending: Array<{ token: InlineToken; children: InlineToken[] | undefined; next: number }> = []
  const enter = (entered: InlineToken): void => {
    open.add(entered)
    pending.push({ token: entered, children: childrenOf(entered), next: 0 })
  }
  enter(token)
  while (pending.length > 0) {
    const frame = pending[pending.length - 1]!
    const children = frame.children
    if (children && frame.next < children.length) {
      const child = children[frame.next++]!
      if (measures.has(child)) continue
      if (open.has(child)) throw new TypeError('Cyclic token graph is not renderable')
      enter(child)
      continue
    }
    let measure: InlineTokenMeasure
    if (!children) {
      measure = { nodes: 0, text: leafText(frame.token).length, depth: 0, link: frame.token.type === 'link' }
    } else {
      let nodes = children.length, text = 0, depth = 0, link = frame.token.type === 'link'
      for (const child of children) {
        const childMeasure = measures.get(child)!
        nodes += childMeasure.nodes
        text += childMeasure.text
        depth = Math.max(depth, childMeasure.depth + 1)
        link ||= childMeasure.link
      }
      measure = { nodes, text, depth, link }
    }
    measures.set(frame.token, measure)
    open.delete(frame.token)
    pending.pop()
  }
  return measures.get(token)!
}

/** A document's allowances, from its token and output limits. */
export function createInlineDocument(budget: TokenBudget | undefined, maxOutputLength: number | undefined): InlineDocument {
  const nodeLimit = budget
    ? { limit: budget.limit, name: budget.name }
    : maxOutputLength === undefined ? undefined : { limit: maxOutputLength, name: 'maxOutputLength' }
  return {
    spentNodes: 0,
    spentText: 0,
    measures: new WeakMap(),
    maxNodes: nodeLimit ? CUSTOM_NODES_FACTOR * nodeLimit.limit : Infinity,
    maxText: maxOutputLength ?? Infinity,
    nodeLimit: nodeLimit ? `${CUSTOM_NODES_FACTOR} times ${nodeLimit.name} ${nodeLimit.limit}` : '',
    textLimit: `maxOutputLength ${maxOutputLength}`,
  }
}

/** Spends what custom tokens expanded to, refusing the document past its allowances. */
export function spendInlineDocument(document: InlineDocument, nodes: number, text: number): void {
  if (nodes > document.maxNodes - document.spentNodes) {
    throw new RangeError(`Custom inline tokens' children exceed ${document.nodeLimit}`)
  }
  if (text > document.maxText - document.spentText) {
    throw new RangeError(`Custom inline tokens' text exceeds ${document.textLimit}`)
  }
  document.spentNodes += nodes
  document.spentText += text
}

/**
 * Charges a token a custom rule returned. Its children count against the
 * token budget, which they return if the token is discarded; the caller
 * charges the token itself. What it expands to counts against the document,
 * which it doesn't.
 */
export function chargeCustomToken(token: InlineToken, document: InlineDocument, budget: TokenBudget | undefined): void {
  const measure = measureCustomToken(token, document.measures)
  if (budget && measure.nodes > 0) consumeTokenBudget(budget, measure.nodes)
  spendInlineDocument(document, measure.nodes, measure.text)
}
