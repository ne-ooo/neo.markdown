import type { BlockRule } from '../../core/types.js'

const OPENING_FENCE = /^( {0,3})(`{3,}|~{3,})([^\n]*)(?:\n|$)/

/** Fenced code block rule (` ``` ` or `~~~`). */
export const code: BlockRule = {
  name: 'code',
  priority: 900,
  starts(src) {
    const opening = OPENING_FENCE.exec(src)
    return Boolean(opening && !(opening[2][0] === '`' && opening[3].trim().includes('`')))
  },
  tokenize(src) {
    const opening = OPENING_FENCE.exec(src)
    if (!opening) return null

    const fence = opening[2]
    const fenceChar = fence[0]
    const infoString = opening[3].trim()
    if (fenceChar === '`' && infoString.includes('`')) return null

    const contentStart = opening[0].length
    let cursor = contentStart
    let contentEnd = src.length
    let rawEnd = src.length

    while (cursor < src.length) {
      const newline = src.indexOf('\n', cursor)
      const lineEnd = newline === -1 ? src.length : newline
      const closing = /^ {0,3}(`+|~+)[ \t]*$/.exec(src.slice(cursor, lineEnd))
      if (closing && closing[1][0] === fenceChar && closing[1].length >= fence.length) {
        contentEnd = cursor
        rawEnd = newline === -1 ? lineEnd : lineEnd + 1
        break
      }
      if (newline === -1) break
      cursor = newline + 1
    }

    const raw = src.slice(0, rawEnd)
    const text = src.slice(contentStart, contentEnd).replace(/\n$/, '')
    let lang: string | undefined
    let meta: string | undefined

    if (infoString) {
      const space = infoString.indexOf(' ')
      if (space === -1) {
        lang = infoString
      } else {
        lang = infoString.substring(0, space)
        meta = infoString.substring(space + 1).trim() || undefined
      }
    }

    return { token: { type: 'code', raw, lang, meta, text }, raw }
  },
}
