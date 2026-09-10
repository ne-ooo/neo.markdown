/** Optional GFM-only inline tokenization support. */

import type { InlineToken } from '../core/types.js'

const AUTOLINK = /^((?:https?:\/\/|ftp:\/\/|www\.)[^\s<]+)/i

type AutolinkResult = { token: InlineToken; raw: string }

export interface GfmInlineSupport {
  filterHtml(html: string): string
  emailLinks(source: string): Map<number, AutolinkResult>
  textPattern(extra: string, single: boolean): RegExp
  isAutolinkStart(char: number): boolean
  isTildeCloser(source: string, index: number): number
  tokenizeDelete(
    source: string,
    cursor: number,
    tildeClosers: number[][],
    tokenizeChildren: (text: string) => InlineToken[]
  ): { raw: string; token: InlineToken } | null
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
  textPattern(extra, single) {
    return new RegExp(`^(?:(?!https?:\\/\\/|ftp:\\/\\/|www\\.)[^*_\`[<\\n\\\\!~${extra}])${single ? '' : '+'}`, 'i')
  },
  isAutolinkStart(char) {
    return char === 72 || char === 104 || char === 70 || char === 102 || char === 87 || char === 119
  },
  filterHtml(html) {
    return html.replace(/<(\/?)(title|textarea|style|xmp|iframe|noembed|noframes|script|plaintext)(?=[\t\n\f\r />])/gi, '&lt;$1$2')
  },
  emailLinks(source) {
    const links = new Map<number, AutolinkResult>()
    if (!source.includes('@')) return links
    // Scan each local-part run once. Retrying an email regex at every letter
    // would be quadratic on a long word without an @ character.
    const local = /(?:mailto:|xmpp:)?[a-z\d._+\-]+/gi
    const domain = /[a-z\d._-]+/iy
    const resource = /\/[a-z\d@.]+/iy
    let match: RegExpExecArray | null
    while ((match = local.exec(source))) {
      if (source[local.lastIndex] !== '@') continue
      domain.lastIndex = local.lastIndex + 1
      const host = domain.exec(source)
      if (!host) continue
      local.lastIndex = domain.lastIndex
      const name = host[0].replace(/\.+$/, '')
      if (!name.includes('.') || !/[a-z\d]$/i.test(name)) continue
      let end = host.index + name.length
      const explicit = /^(?:mailto:|xmpp:)/i.test(match[0])
      if (/^xmpp:/i.test(match[0])) {
        resource.lastIndex = end
        const suffix = resource.exec(source)
        if (suffix) end = resource.lastIndex
      }
      const raw = source.slice(match.index, end)
      links.set(match.index, {
        raw,
        token: { type: 'link', raw, href: explicit ? raw : `mailto:${raw}`, text: raw,
          tokens: [{ type: 'text', raw, text: raw }] },
      })
      local.lastIndex = end
    }
    return links
  },
  isTildeCloser(source, index) {
    if (source[index] !== '~' || source[index - 1] === '~') return 0
    const length = source[index + 1] === '~' ? 2 : 1
    if (source[index + length] === '~' || !index || /\s/.test(source[index - 1])) return 0
    return length
  },

  tokenizeDelete(source, cursor, tildeClosers, tokenizeChildren) {
    if (source[cursor - 1] === '~') return null
    const length = source[cursor + 1] === '~' ? 2 : 1
    if (source[cursor + length] === '~' || !source[cursor + length] || /\s/.test(source[cursor + length])) return null
    const closing = findPosition(tildeClosers[length], cursor + length + 1)
    if (closing === -1) return null

    const raw = source.slice(cursor, closing + length)
    const text = source.slice(cursor + length, closing)
    return { raw, token: { type: 'del', raw, text, tokens: tokenizeChildren(text) } }
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
