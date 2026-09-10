import type { BlockRule } from '../../core/types.js'
import { decodeMarkdown } from '../../utils/markdown-text.js'
import { stripIndent } from '../whitespace.js'

const OPENING_FENCE = /^( {0,3})(`{3,}|~{3,})([^\n]*)(?:\n|$)/
interface FenceState { kind: 'fence'; cursor: number; text: string }

/** Fenced code block rule (` ``` ` or `~~~`). */
export const code: BlockRule = {
  name: 'code',
  priority: 900,
  starts(src) {
    const opening = OPENING_FENCE.exec(src)
    return Boolean(opening && !(opening[2][0] === '`' && opening[3].trim().includes('`')))
  },
  tokenize(src, _options, context) {
    const opening = OPENING_FENCE.exec(src)
    if (!opening) return null

    const fence = opening[2]
    const fenceChar = fence[0]
    const infoString = opening[3].trim()
    if (fenceChar === '`' && infoString.includes('`')) return null

    const contentStart = opening[0].length
    const continuation = context?.continuation
    const previous = continuation?.previous as FenceState | undefined
    const saved = previous?.kind === 'fence' ? previous : undefined
    let cursor = saved?.cursor ?? contentStart
    let text = saved?.text ?? ''
    if (saved) continuation!.reused(cursor)
    let rawEnd = src.length

    while (cursor < src.length) {
      const newline = src.indexOf('\n', cursor)
      const lineEnd = newline === -1 ? src.length : newline
      context?.dependOn?.(newline < 0 ? src.length + 1 : newline + 1)
      const closing = /^ {0,3}(`+|~+)[ \t]*$/.exec(src.slice(cursor, lineEnd))
      if (closing && closing[1][0] === fenceChar && closing[1].length >= fence.length) {
        rawEnd = newline === -1 ? lineEnd : lineEnd + 1
        break
      }
      text += stripIndent(src.slice(cursor, lineEnd), opening[1].length) + (newline < 0 ? '' : '\n')
      if (newline === -1) break
      cursor = newline + 1
      if (continuation) {
        const end = cursor, prefix = text
        continuation.retain(() => ({ kind: 'fence', cursor: end, text: prefix } satisfies FenceState))
      }
    }

    const raw = src.slice(0, rawEnd)
    let lang: string | undefined
    let meta: string | undefined

    if (infoString) {
      const space = infoString.search(/[ \t]/)
      if (space === -1) {
        lang = decodeMarkdown(infoString)
      } else {
        lang = decodeMarkdown(infoString.substring(0, space))
        meta = infoString.substring(space + 1).trim() || undefined
      }
    }

    return { token: { type: 'code', raw, lang, meta, info: opening[3], text }, raw }
  },
}
