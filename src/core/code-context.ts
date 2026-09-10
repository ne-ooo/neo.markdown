import type { CodeToken, CodeBlockContext } from './types.js'

/** Create a per-render snapshot without changing the caller's code token. */
export function createCodeBlockContext(token: CodeToken): CodeBlockContext {
  const snapshot = Object.freeze({ ...token })
  let lineCount: number | undefined
  const context: CodeBlockContext = {
    token: snapshot, source: snapshot.text,
    language: snapshot.lang?.trim().toLowerCase() || undefined,
    rawLanguage: snapshot.lang, rawInfo: snapshot.info, rawMeta: snapshot.meta,
    get lineCount() {
      if (lineCount === undefined) {
        lineCount = snapshot.text.length ? 1 : 0
        for (let index = 0; index < snapshot.text.length; index++) {
          if (snapshot.text[index] === '\r') { lineCount++; if (snapshot.text[index + 1] === '\n') index++ }
          else if (snapshot.text[index] === '\n') lineCount++
        }
        if (/[\r\n]$/.test(snapshot.text)) lineCount--
      }
      return lineCount
    },
  }
  return Object.freeze(context)
}
