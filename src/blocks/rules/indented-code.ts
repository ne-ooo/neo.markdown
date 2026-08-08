import type { BlockRule } from '../../core/types.js'

const INDENTED_CODE = /^(?: {4}|\t).+(?:\n(?: {4}|\t).+)*(?:\n|$)/

/** Indented code block rule (four spaces or one tab). */
export const indentedCode: BlockRule = {
  name: 'indentedCode',
  priority: 500,
  starts: (src) => INDENTED_CODE.test(src),
  tokenize(src) {
    const match = INDENTED_CODE.exec(src)
    if (!match) return null
    const raw = match[0]
    const text = raw
      .split('\n')
      .map((line) => line.startsWith('    ')
        ? line.substring(4)
        : line.startsWith('\t') ? line.substring(1) : line)
      .join('\n')
      .replace(/\n+$/, '')
    return { token: { type: 'code', raw, lang: undefined, text }, raw }
  },
}
