import { dependOnLine } from '../dependencies.js'
import type { BlockRule } from '../../core/types.js'

/** Paragraph fallback rule. */
export const paragraph: BlockRule = {
  name: 'paragraph',
  priority: 100,
  starts: (src) => Boolean(src[0] && src.charCodeAt(0) !== 10),
  tokenize(src, _options, context) {
    const firstNewline = src.indexOf('\n')
    const firstLine = firstNewline === -1 ? src : src.slice(0, firstNewline)
    if (/^[ \t]*$/.test(firstLine)) return null

    const lines = [firstLine]
    let cursor = firstNewline === -1 ? src.length : firstNewline + 1
    while (cursor < src.length) {
      dependOnLine(src, cursor, context)
      const newline = src.indexOf('\n', cursor)
      const lineEnd = newline === -1 ? src.length : newline
      const line = src.slice(cursor, lineEnd)
      if (/^[ \t]*$/.test(line) || context?.interruptsParagraph(src.slice(cursor), 100)) break
      lines.push(line)
      if (newline === -1) {
        cursor = src.length
        break
      }
      cursor = newline + 1
    }

    const raw = lines.join('\n')
    const text = lines.map((line) => line.replace(/^[ \t]+/, '')).join('\n').replace(/[ \t\n]+$/, '')
    if (!text) return null
    return { token: { type: 'paragraph', raw, text, tokens: [] }, raw }
  },
}
