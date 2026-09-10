import type { InlineToken } from './types.js'
import { consumeTokenBudget, type TokenBudget } from './token-budget.js'

export interface EmphasisDelimiter {
  index: number
  start: number
  length: number
  char: string
  open: boolean
  close: boolean
}
interface Node { token: InlineToken; previous?: Node; next?: Node; depth: number }
interface Delimiter extends EmphasisDelimiter { node: Node; previous?: Delimiter; next?: Delimiter; originalLength: number }

export function delimiterFlags(source: string, start: number, length: number) {
  const previous = Array.from(source.slice(Math.max(0, start - 2), start)).at(-1) ?? ''
  const next = String.fromCodePoint(source.codePointAt(start + length) ?? 32)
  const beforeSpace = !previous || /\s/u.test(previous)
  const afterSpace = /\s/u.test(next)
  const beforePunctuation = /[\p{P}\p{S}]/u.test(previous)
  const afterPunctuation = /[\p{P}\p{S}]/u.test(next)
  const left = !afterSpace && (!afterPunctuation || beforeSpace || beforePunctuation)
  const right = !beforeSpace && (!beforePunctuation || afterSpace || afterPunctuation)
  return source[start] === '_'
    ? { open: left && (!right || beforePunctuation), close: right && (!left || afterPunctuation) }
    : { open: left, close: right }
}

/** Resolve delimiter runs on linked lists, including CommonMark's rule of three. */
export function resolveEmphasis(tokens: InlineToken[], runs: EmphasisDelimiter[], source: string, budget?: TokenBudget, maxDepth = 32): InlineToken[] {
  if (runs.length === 0) {
    const result: InlineToken[] = []
    for (const token of tokens) {
      const previous = result.at(-1)
      if (previous?.type === 'text' && token.type === 'text') {
        previous.raw += token.raw
        previous.text += token.text
      } else {
        if (token.type === 'text') consumeTokenBudget(budget)
        result.push(token)
      }
    }
    return result
  }
  const head: Node = { token: { type: 'text', raw: '', text: '' }, depth: 0 }
  const nodes: Node[] = []
  let tail = head
  for (const token of tokens) {
    const pending = [{ token, depth: 0 }]
    let depth = 0
    while (pending.length) {
      const current = pending.pop()!
      depth = Math.max(depth, current.depth)
      if ('tokens' in current.token) {
        for (const child of current.token.tokens) pending.push({ token: child, depth: current.depth + 1 })
      }
    }
    const node: Node = { token, previous: tail, depth }
    tail.next = node; tail = node; nodes.push(node)
  }
  const delimiters: Delimiter[] = runs.map(run => ({ ...run, originalLength: run.length, node: nodes[run.index] }))
  for (let index = 0; index < delimiters.length; index++) {
    delimiters[index].previous = delimiters[index - 1]
    delimiters[index].next = delimiters[index + 1]
  }
  function remove(run: Delimiter) {
    if (run.previous) run.previous.next = run.next
    if (run.next) run.next.previous = run.previous
  }
  const bottoms = new Map<string, number>()
  let closer = delimiters[0]
  while (closer) {
    if (!closer.close) { closer = closer.next!; continue }
    const key = closer.char + Number(closer.open) + (closer.originalLength % 3)
    const bottom = bottoms.get(key) ?? -1
    let opener = closer.previous
    while (opener && opener.start > bottom) {
      if (opener.open && opener.char === closer.char && !(
        (opener.close || closer.open)
        && (opener.originalLength + closer.originalLength) % 3 === 0
        && (opener.originalLength % 3 !== 0 || closer.originalLength % 3 !== 0)
      )) break
      opener = opener.previous
    }
    if (!opener || opener.start <= bottom) {
      bottoms.set(key, closer.previous?.start ?? -1)
      const next = closer.next
      if (!closer.open) remove(closer)
      closer = next!
      continue
    }
    const use = opener.length >= 2 && closer.length >= 2 ? 2 : 1
    const children: InlineToken[] = []
    let depth = 1
    for (let node = opener.node.next; node && node !== closer.node; node = node.next) {
      children.push(node.token); depth = Math.max(depth, node.depth + 1)
    }
    for (let run = opener.next; run && run !== closer;) {
      const next = run.next; remove(run); run = next
    }
    // Leave the remaining runs literal at the nesting limit. Repeatedly
    // searching or rebuilding larger outer subtrees would waste work and tokens.
    if (depth > maxDepth) break
    const start = opener.start + opener.length - use
    const end = closer.start + use
    const raw = source.slice(start, end)
    const wrapper: Node = {
      token: { type: use === 2 ? 'strong' : 'em', raw,
        text: source.slice(start + use, end - use), tokens: children },
      depth, previous: opener.node, next: closer.node,
    }
    consumeTokenBudget(budget)
    opener.node.next = wrapper; closer.node.previous = wrapper
    opener.length -= use; closer.length -= use; closer.start += use
    opener.node.token.raw = opener.node.token.raw.slice(0, -use)
    if (opener.node.token.type === 'text') opener.node.token.text = opener.node.token.raw
    closer.node.token.raw = closer.node.token.raw.slice(use)
    if (closer.node.token.type === 'text') closer.node.token.text = closer.node.token.raw
    if (!opener.length) {
      opener.node.previous!.next = wrapper; wrapper.previous = opener.node.previous; remove(opener)
    }
    if (!closer.length) {
      wrapper.next = closer.node.next
      if (closer.node.next) closer.node.next.previous = wrapper
      const next = closer.next; remove(closer); closer = next!
    }
  }
  const result: InlineToken[] = []
  for (let node = head.next; node; node = node.next) {
    const token = node.token
    const previous = result.at(-1)
    if (previous?.type === 'text' && token.type === 'text') {
      previous.raw += token.raw; previous.text += token.text
    } else {
      if (token.type === 'text') consumeTokenBudget(budget)
      result.push(token)
    }
  }
  return result
}
