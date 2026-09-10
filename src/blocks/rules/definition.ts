import type { BlockRule } from '../../core/types.js'
import { decodeMarkdown, normalizeDestination } from '../../utils/markdown-text.js'
import { scanDestination, scanTitle } from '../../utils/link-syntax.js'

export const definition: BlockRule = {
  name: 'definition',
  priority: 875,
  starts: () => false,
  tokenize(src, _options, context) {
    const opening = /^ {0,3}\[/.exec(src)
    if (!opening) return null
    const start = opening[0].length
    let cursor = start
    try {
      while (cursor < src.length && cursor - start <= 999) {
        if (src[cursor] === '\\' && /[\[\]\\]/.test(src[cursor + 1] ?? '')) { cursor += 2; continue }
        if (src[cursor] === '[') return null
        if (src[cursor] === ']') break
        cursor++
      }
      const label = src.slice(start, cursor)
      if (!label.trim() || label.length > 999 || src.slice(cursor, cursor + 2) !== ']:') return null
      cursor += 2
      const space = /^[ \t]*(?:\n[ \t]*)?/.exec(src.slice(cursor))![0]
      cursor += space.length
      const destination = scanDestination(src, cursor, context?.dependOn)
      if (!destination) return null
      cursor = destination.end
      const after = /^[ \t]*/.exec(src.slice(cursor))![0]
      cursor += after.length
      let end = cursor
      if (src[end] === '\n') end++
      else if (end !== src.length && !after) return null
      const separator = /^[ \t]*(?:\n[ \t]*)?/.exec(src.slice(destination.end))![0]
      context?.dependOn?.(destination.end + separator.length + 1)
      const title = separator ? scanTitle(src, destination.end + separator.length, context?.dependOn) : null
      let titleValue: string | undefined
      if (title) {
        if (context?.dependOn) context.dependOn(title.end + /^[ \t]*/.exec(src.slice(title.end))![0].length + 1)
        const suffix = /^[ \t]*(?:\n|$)/.exec(src.slice(title.end))
        if (suffix) { end = title.end + suffix[0].length; titleValue = decodeMarkdown(title.value) }
        else if (src[cursor] !== '\n' && cursor !== src.length) return null
      } else if (src[cursor] !== '\n' && cursor !== src.length) return null
      const raw = src.slice(0, end)
      return { token: { type: 'definition', raw, label, href: normalizeDestination(destination.value), title: titleValue }, raw }
    } finally { context?.dependOn?.(Math.min(src.length + 1, cursor + 2)) }
  },
}
