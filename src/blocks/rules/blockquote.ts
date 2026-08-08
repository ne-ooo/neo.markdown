import type { BlockRule } from '../../core/types.js'

const BLOCKQUOTE = /^(?:> ?[^\n]*\n?)+/

/** Blockquote container rule. */
export const blockquote: BlockRule = {
  name: 'blockquote',
  priority: 650,
  starts: (src) => BLOCKQUOTE.test(src),
  tokenize(src, _options, context) {
    if (context && context.depth >= context.maxNestingDepth) return null
    const match = BLOCKQUOTE.exec(src)
    if (!match) return null
    const raw = match[0]
    const text = raw.replace(/^ *> ?/gm, '')
    const tokens = context ? context.tokenize(text, context.depth + 1) : []
    return { token: { type: 'blockquote', raw, tokens }, raw }
  },
}
