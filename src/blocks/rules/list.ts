import { dependOnLine } from '../dependencies.js'
import type { BlockRule, ListItemToken } from '../../core/types.js'
import { indentation, stripIndent } from '../whitespace.js'
import { listMarker, ParagraphState } from '../container-state.js'

interface ListState {
  kind: 'list'; cursor: number; items: ListItemToken[]; loose: boolean; previousBlank: boolean; cost: number
  current: {
    start: number; marker: NonNullable<ReturnType<typeof listMarker>>; content: string
    task: string | undefined; lines: string[]; lazy: number[]; contentLength: number; blank: boolean
    paragraph: ReturnType<ParagraphState['snapshot']>
  }
}

export const list: BlockRule = {
  name: 'list',
  priority: 600,
  starts(src) {
    const marker = listMarker(src.slice(0, src.indexOf('\n') < 0 ? src.length : src.indexOf('\n')))
    return Boolean(marker && /[^ \t]/.test(marker.text) && (!marker.ordered || parseInt(marker.marker, 10) === 1))
  },
  tokenize(src, options, context) {
    if (context && context.depth >= context.maxNestingDepth) return null
    const first = listMarker(src)
    if (!first) return null
    const continuation = context?.continuation
    const previous = continuation?.previous as ListState | undefined
    const saved = previous?.kind === 'list' ? previous : undefined
    const initialBudget = continuation?.budget() ?? 0
    const items: ListItemToken[] = saved?.items.slice() ?? []
    let cursor = saved?.cursor ?? 0
    let loose = saved?.loose ?? false
    let previousBlank = saved?.previousBlank ?? false
    let pending = saved?.current
    if (saved) { context!.consumeTokens(saved.cost); continuation!.reused(cursor) }
    while (cursor < src.length || pending) {
      const resumed = pending
      pending = undefined
      let marker: NonNullable<ReturnType<typeof listMarker>>
      let itemStart: number
      let content: string
      let task: string | undefined
      let lines: string[]
      let lazy: Set<number>
      let state: ParagraphState
      let contentLength: number
      let blank: boolean
      if (resumed) {
        marker = resumed.marker; itemStart = resumed.start; content = resumed.content; task = resumed.task
        lines = resumed.lines.slice(); lazy = new Set(resumed.lazy); state = new ParagraphState(resumed.paragraph)
        contentLength = resumed.contentLength; blank = resumed.blank
      } else {
        dependOnLine(src, cursor, context)
        const newline = src.indexOf('\n', cursor)
        const lineEnd = newline < 0 ? src.length : newline
        const found = listMarker(src.slice(cursor, lineEnd))
        if (!found || found.marker.at(-1) !== first.marker.at(-1)) break
        if (/^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,})$/.test(src.slice(cursor, lineEnd))) break
        marker = found; itemStart = cursor
        if (items.length && previousBlank) loose = true
        content = /[^ \t]/.test(marker.text) ? marker.text : ''
        const match = options.gfm === true ? /^\[([ xX])\][ \t]+/.exec(content) : null
        task = match?.[1]
        if (match) content = content.slice(match[0].length)
        lines = [content]; lazy = new Set<number>(); state = new ParagraphState()
        state.feed(content)
        contentLength = content.length + 1
        cursor = newline < 0 ? src.length : newline + 1
        blank = false
      }
      const retain = continuation ? () => {
        const end = cursor, count = lines.length, size = contentLength, itemCount = items.length
        const prefixLoose = loose, prefixBlank = previousBlank, tailBlank = blank, paragraph = state.snapshot()
        const cost = initialBudget - continuation.budget()
        continuation.retain(() => ({ kind: 'list', cursor: end, items: items.slice(0, itemCount),
          loose: prefixLoose, previousBlank: prefixBlank, cost, current: {
            start: itemStart, marker, content, task, lines: lines.slice(0, count),
            lazy: [...lazy].filter(offset => offset < size), contentLength: size, blank: tailBlank, paragraph,
          } } satisfies ListState))
      } : undefined
      retain?.()
      while (cursor < src.length) {
        dependOnLine(src, cursor, context)
        const newline = src.indexOf('\n', cursor)
        const next = newline < 0 ? src.length : newline + 1
        const line = src.slice(cursor, newline < 0 ? next : newline)
        if (/^[ \t]*$/.test(line)) {
          if (lines.length === 1 && /^[ \t]*$/.test(content)) break
          lines.push(''); contentLength++; blank = true; state.feed(''); cursor = next; retain?.(); continue
        }
        const indent = indentation(line)
        let body: string
        if (indent >= marker.contentIndent) {
          body = stripIndent(line, marker.contentIndent)
          if (context?.isLazyLine?.(cursor)) lazy.add(contentLength)
          else state.feed(body)
        } else {
          if (listMarker(line) || blank || !state.open || context?.interruptsParagraph(src.slice(cursor), 100)) break
          body = line
          lazy.add(contentLength)
        }
        lines.push(body); contentLength += body.length + 1
        blank = false; cursor = next; retain?.()
      }
      previousBlank = blank || (lines.length === 1 && /^[ \t]*$/.test(content) && /^[ \t]*\n/.test(src.slice(cursor)))
      const text = lines.join('\n') + '\n'
      const tokens = context ? context.tokenize(text, context.depth + 1, lazy, itemStart) : []
      // Blank lines inside a child block do not make its containing list loose.
      let offset = 0
      for (let index = 0; index < tokens.length; index++) {
        const token = tokens[index]
        const start = text.indexOf(token.raw, offset)
        if (index > 0 && start >= 0 && (
          /\n[ \t]*\n/.test(text.slice(Math.max(0, offset - 1), start))
          || (tokens[index - 1].type !== 'code' && /\n[ \t]*\n$/.test(tokens[index - 1].raw))
        )) loose = true
        offset = Math.max(offset, start + token.raw.length)
      }
      context?.consumeTokens()
      items.push({ text: content, loose: false, ...(task ? { task: true, checked: task.toLowerCase() === 'x' } : {}), tokens })
      if (previousBlank) {
        while (/^[ \t]*\n/.test(src.slice(cursor))) cursor += /^[ \t]*\n/.exec(src.slice(cursor))![0].length
      }
    }
    if (!items.length) return null
    const raw = src.slice(0, cursor)
    return { token: { type: 'list', raw, ordered: first.ordered,
      start: first.ordered ? parseInt(first.marker, 10) : undefined,
      items: loose ? items.map(item => ({ ...item, loose: true })) : items }, raw }
  },
}
