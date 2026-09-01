/** Optional GFM-only inline tokenization support. */

import type { InlineToken } from '../core/types.js'

const AUTOLINK = /^((?:https?:\/\/|ftp:\/\/|www\.)[^\s<]+)/i

export interface GfmInlineSupport {
  isTildeCloser(source: string, index: number): boolean
  tokenizeDelete(
    source: string,
    cursor: number,
    tildeClosers: number[]
  ): { raw: string; text: string } | null
  tokenizeAutolink(source: string): { token: InlineToken; raw: string } | null
}

function findPosition(positions: number[], minimum: number): number {
  let low = 0
  let high = positions.length

  while (low < high) {
    const middle = low + Math.floor((high - low) / 2)
    if (positions[middle] < minimum) low = middle + 1
    else high = middle
  }

  return positions[low] ?? -1
}

export const gfmInlineSupport: GfmInlineSupport = {
  isTildeCloser(source, index) {
    return source.charCodeAt(index) === 126
      && source.charCodeAt(index + 1) === 126
      && index > 0
      && /\S/.test(source[index - 1])
  },

  tokenizeDelete(source, cursor, tildeClosers) {
    if (!source.startsWith('~~', cursor) || /^\s/.test(source[cursor + 2] ?? '')) {
      return null
    }
    const closing = findPosition(tildeClosers, cursor + 3)
    if (closing === -1) return null

    return {
      raw: source.slice(cursor, closing + 2),
      text: source.slice(cursor + 2, closing),
    }
  },

  tokenizeAutolink(source) {
    const match = AUTOLINK.exec(source)
    if (!match) return null

    let raw = match[0].replace(/[?!.,:*_~]+$/, '')

    if (raw.endsWith(')')) {
      let open = 0
      let close = 0
      for (const char of raw) {
        if (char === '(') open++
        if (char === ')') close++
      }
      while (close > open && raw.endsWith(')')) {
        raw = raw.slice(0, -1)
        close--
      }
    }

    const entitySuffix = /&[a-z\d]+;$/i.exec(raw)
    if (entitySuffix) raw = raw.slice(0, entitySuffix.index)
    if (!raw) return null

    const href = /^www\./i.test(raw) ? `http://${raw}` : raw
    return {
      token: {
        type: 'link',
        raw,
        href,
        text: raw,
        tokens: [{ type: 'text', raw, text: raw }],
      },
      raw,
    }
  },
}
