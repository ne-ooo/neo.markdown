import type { BlockRule } from '../../core/types.js'

const SETEXT_HEADING = /^([^\n]+)\n( {0,3})(=+|-+) *(?:\n+|$)/

/** Setext heading rule. */
export const setextHeading: BlockRule = {
  name: 'setextHeading',
  priority: 850,
  starts: (src) => SETEXT_HEADING.test(src),
  tokenize(src) {
    const match = SETEXT_HEADING.exec(src)
    if (!match) return null
    const raw = match[0]
    const level = match[3][0] === '=' ? 1 : 2
    return {
      token: { type: 'heading', raw, level, text: match[1].trim(), tokens: [] },
      raw,
    }
  },
}
