import { namedEntity } from './entities-data.js'
import { isSafeUrl } from './escape.js'

/** Decode only complete references, after Markdown syntax has been recognized. */
export function decodeEntities(value: string): string {
  return value.replace(/&(?:#([0-9]{1,7})|#[xX]([\da-fA-F]{1,6})|([a-zA-Z][a-zA-Z0-9]{1,31}));/g,
    (raw, decimal: string, hex: string, name: string) => {
      if (name) return namedEntity(name + ';') ?? raw
      const point = parseInt(decimal || hex, decimal ? 10 : 16)
      return point === 0 || point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff)
        ? '\ufffd' : String.fromCodePoint(point)
    })
}

/** Escapes and entities are one pass: an escaped ampersand stays literal. */
export function decodeMarkdown(value: string): string {
  return value.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])|&(?:#[0-9]{1,7}|#[xX][\da-fA-F]{1,6}|[a-zA-Z][a-zA-Z0-9]{1,31});/g,
    (raw, escaped: string) => escaped ?? decodeEntities(raw))
}

export function normalizeDestination(value: string): string {
  const decoded = decodeMarkdown(value)
  // Keep unsafe spellings available to the renderer's URL policy.
  if (!isSafeUrl(decoded)) return decoded
  try {
    return encodeURI(decoded).replace(/%25([\da-f]{2})/gi, '%$1')
  } catch {
    return decoded
  }
}
