import { dependOnLine } from '../dependencies.js'
import type { BlockRule } from '../../core/types.js'
import { stripIndent } from '../whitespace.js'
import { ParagraphState } from '../container-state.js'

interface QuoteState {
  kind: 'blockquote'; cursor: number; length: number; lines: string[]; lazy: number[]
  paragraph: ReturnType<ParagraphState['snapshot']>
}

export const blockquote: BlockRule = {
  name: 'blockquote',
  priority: 650,
  starts: (src) => /^ {0,3}>/.test(src),
  tokenize(src, _options, context) {
    if (context && context.depth >= context.maxNestingDepth) return null
    if (!/^ {0,3}>/.test(src)) return null
    const continuation = context?.continuation
    const previous = continuation?.previous as QuoteState | undefined
    const saved = previous?.kind === 'blockquote' ? previous : undefined
    const state = new ParagraphState(saved?.paragraph)
    const lines: string[] = saved?.lines.slice() ?? []
    const lazy = new Set<number>(saved?.lazy)
    let length = saved?.length ?? 0
    let cursor = saved?.cursor ?? 0
    if (saved) continuation!.reused(cursor)
    while (cursor < src.length) {
      dependOnLine(src, cursor, context)
      const newline = src.indexOf('\n', cursor)
      const next = newline < 0 ? src.length : newline + 1
      const line = src.slice(cursor, newline < 0 ? next : newline)
      const prefix = /^ {0,3}>/.exec(line)
      let content: string
      if (prefix) {
        content = stripIndent(line.slice(prefix[0].length), 1, prefix[0].length)
        if (context?.isLazyLine?.(cursor)) lazy.add(length)
        else state.feed(content)
      } else {
        if (!state.open || /^[ \t]*$/.test(line) || context?.interruptsParagraph(src.slice(cursor), 100)) break
        content = line
        lazy.add(length)
      }
      lines.push(content)
      length += content.length + 1
      cursor = next
      if (continuation) {
        const end = cursor, count = lines.length, size = length, paragraph = state.snapshot()
        continuation.retain(() => ({ kind: 'blockquote', cursor: end, length: size,
          lines: lines.slice(0, count), lazy: [...lazy].filter(offset => offset < size), paragraph } satisfies QuoteState))
      }
    }
    const raw = src.slice(0, cursor)
    const tokens = context ? context.tokenize(lines.join('\n'), context.depth + 1, lazy) : []
    return { token: { type: 'blockquote', raw, tokens }, raw }
  },
}
