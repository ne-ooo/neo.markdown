import { dependOnLine } from '../dependencies.js'
import type { BlockRule } from '../../core/types.js'
import { indentation, stripIndent } from '../whitespace.js'

export const indentedCode: BlockRule = {
  name: 'indentedCode',
  priority: 500,
  // Indented code cannot interrupt an open paragraph.
  starts: () => false,
  tokenize(src, _options, context) {
    const firstEnd = src.indexOf('\n')
    if (indentation(src) < 4 || !src.slice(0, firstEnd < 0 ? src.length : firstEnd).trim()) return null
    const lines: string[] = []
    let cursor = 0
    let end = 0
    let contentLines = 0
    while (cursor < src.length) {
      dependOnLine(src, cursor, context)
      const newline = src.indexOf('\n', cursor)
      const next = newline < 0 ? src.length : newline + 1
      const line = src.slice(cursor, newline < 0 ? next : newline)
      const blank = /^[ \t]*$/.test(line)
      if (!blank && indentation(line) < 4) break
      lines.push(stripIndent(line, 4))
      if (!blank) { end = next; contentLines = lines.length }
      cursor = next
    }
    if (cursor >= src.length) context?.dependOn?.(src.length + 1)
    const raw = src.slice(0, end)
    return { token: { type: 'code', raw, text: lines.slice(0, contentLines).join('\n') + '\n' }, raw }
  },
}
