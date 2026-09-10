import { dependOnLine } from '../dependencies.js'
import type { BlockRule } from '../../core/types.js'
import { indentation } from '../whitespace.js'
import { listMarker } from '../container-state.js'

export const setextHeading: BlockRule = {
  name: 'setextHeading',
  // Plugins positioned immediately before paragraphs get the first chance.
  priority: 100.5,
  starts: () => false,
  tokenize(src, _options, context) {
    if (indentation(src) >= 4 || listMarker(src) || context?.interruptsParagraph(src, 100)) return null
    const lines: string[] = []
    let cursor = 0
    while (cursor < src.length) {
      dependOnLine(src, cursor, context)
      const newline = src.indexOf('\n', cursor)
      const next = newline < 0 ? src.length : newline + 1
      const line = src.slice(cursor, newline < 0 ? next : newline)
      const underline = /^ {0,3}(=+|-+)[ \t]*$/.exec(line)
      if (lines.length && underline && !context?.isLazyLine?.(cursor)) {
        const raw = src.slice(0, next)
        return { token: { type: 'heading', raw, level: underline[1][0] === '=' ? 1 : 2,
          text: lines.map(line => line.replace(/^[ \t]+/, '')).join('\n').replace(/[ \t\n]+$/, ''), tokens: [] }, raw }
      }
      if (/^[ \t]*$/.test(line) || (cursor > 0 && context?.interruptsParagraph(src.slice(cursor), 100))) break
      lines.push(line)
      cursor = next
    }
    return null
  },
}
