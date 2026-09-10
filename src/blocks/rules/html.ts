import type { BlockRule } from '../../core/types.js'
import { htmlBlockStart } from '../../utils/html-syntax.js'
import { dependOnLine } from '../dependencies.js'

export const html: BlockRule = {
  name: 'html',
  priority: 550,
  starts: (src, options) => options.allowHtml === true && htmlBlockStart(src.split('\n', 1)[0])?.interrupts === true,
  tokenize(src, options, context) {
    if (!options.allowHtml) return null
    const start = htmlBlockStart(src.split('\n', 1)[0])
    if (!start) return null
    let cursor = 0
    while (cursor < src.length) {
      dependOnLine(src, cursor, context)
      const newline = src.indexOf('\n', cursor)
      const next = newline < 0 ? src.length : newline + 1
      const line = src.slice(cursor, newline < 0 ? next : newline)
      if (!start.close && /^[ \t]*$/.test(line)) break
      cursor = next
      if (start.close?.test(line)) break
    }
    const raw = src.slice(0, cursor)
    return { token: { type: 'html', raw, text: raw }, raw }
  },
}
