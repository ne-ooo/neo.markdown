import type { BlockRule } from '../../core/types.js'

const HORIZONTAL_RULE = /^ {0,3}((?:- *){3,}|(?:_ *){3,}|(?:\* *){3,})(?:\n+|$)/

/** Horizontal rule (`---`, `***`, or `___`). */
export const hr: BlockRule = {
  name: 'hr',
  priority: 750,
  starts: (src) => HORIZONTAL_RULE.test(src),
  tokenize(src) {
    const match = HORIZONTAL_RULE.exec(src)
    if (!match) return null
    const raw = match[0]
    return { token: { type: 'hr', raw }, raw }
  },
}
