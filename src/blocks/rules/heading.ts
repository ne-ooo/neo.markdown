import type { BlockRule } from '../../core/types.js'

const HEADING = /^ {0,3}(#{1,6})(?=[ \t\n]|$)(.*)(?:\n+|$)/

/** ATX heading rule (`# Heading`). */
export const heading: BlockRule = {
  name: 'heading',
  priority: 800,
  starts: (src) => HEADING.test(src),
  tokenize(src) {
    const match = HEADING.exec(src)
    if (!match) return null
    const raw = match[0]
    const level = match[1].length as 1 | 2 | 3 | 4 | 5 | 6
    const text = match[2].replace(/(?:^|[ \t]+)#+[ \t]*$/, '').replace(/^[ \t]+|[ \t]+$/g, '')
    return { token: { type: 'heading', raw, level, text, tokens: [] }, raw }
  },
}
