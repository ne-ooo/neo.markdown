/**
 * Inline tokenizer for parsing inline markdown elements
 */

import type { InlineRule, InlineToken, LinkReference } from './types.js'

/**
 * Inline regex patterns
 */
const PATTERNS = {
  // Escape (backslash)
  escape: /^\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/,

  // Code (inline)
  code: /^(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/,

  // Bold/Strong (**text** or __text__)
  // Note: Must be checked before em pattern to take precedence
  strong: /^\*\*(?=\S)([\s\S]*?\S)\*\*(?!\*)|^__(?=\S)([\s\S]*?\S)__(?!_)/,

  // Italic/Em (*text* or _text_)
  // Phase 2: Removed negative lookahead (?!\*) to allow nesting like *italic **bold***
  // The strong pattern is checked first, so **text** won't be caught by this
  em: /^\*(?=\S)([\s\S]*?\S)\*|^_(?=\S)([\s\S]*?\S)_/,

  // Strikethrough (~~text~~) - Phase 4: GFM extension
  del: /^~~(?=\S)([\s\S]*?\S)~~/,

  // Extended autolink (GFM) - Phase 4
  // Phase 6: Optimized - use greedy match
  autolink: /^((?:https?:\/\/|ftp:\/\/|www\.)[^\s<]+)/i,

  // CommonMark angle autolinks: <scheme:destination> and <name@example.com>
  angleUri: /^<([A-Za-z][A-Za-z\d+.-]{1,31}:[^<>\x00-\x20]*)>/,
  angleEmail: /^<([A-Za-z\d.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z\d](?:[A-Za-z\d-]{0,61}[A-Za-z\d])?(?:\.[A-Za-z\d](?:[A-Za-z\d-]{0,61}[A-Za-z\d])?)*)>/,

  // Raw inline HTML (only emitted when allowHtml is true)
  html: /^(?:<!--[\s\S]*?(?:-->|$)|<\?[\s\S]*?(?:\?>|$)|<!\[CDATA\[[\s\S]*?(?:\]\]>|$)|<![A-Z][^>\n]*>|<\/?[A-Za-z][^>\n]*>)/,

  // Line break (two spaces + newline)
  br: /^ {2,}\n(?!\s*$)/,

  // Plain text (everything else)
  // Phase 6: Keep negative lookahead for autolinks (necessary for correct parsing)
  text: /^(?:(?!https?:\/\/|ftp:\/\/|www\.)[^*_`[<\n\\!~])+/i,
}

const INLINE_RULE_PRIORITIES: Readonly<Record<string, number>> = {
  escape: 1000,
  code: 900,
  strong: 800,
  em: 700,
  del: 650,
  link: 600,
  angleAutolink: 575,
  html: 550,
  br: 500,
  autolink: 400,
  text: 0,
}
const DEFAULT_CUSTOM_PRIORITY = 750

type InlineResult = { token: InlineToken; raw: string }

interface ParsedLinkDestination {
  end: number
  href: string
  title?: string
}

interface LinkScan {
  closingBrackets: number[]
  openingAngles: number[]
  closingAngles: number[]
  whitespaces: number[]
  doubleQuotes: number[]
  singleQuotes: number[]
  matchingParentheses: Map<number, number>
  parenthesisBalance: Int32Array
  destinations: Map<number, ParsedLinkDestination | null>
}

interface ResolvedInlineRule {
  rule: InlineRule
  priority: number
  order: number
}

/**
 * Options for inline tokenizer
 */
export interface InlineTokenizerOptions {
  /** When true, bare newlines produce <br> (GFM-style line breaks) */
  breaks?: boolean
  /** When false, skip strikethrough and autolink parsing */
  gfm?: boolean
  /** When true, preserve raw inline HTML tokens. */
  allowHtml?: boolean
}

/**
 * Inline tokenizer class
 */
export class InlineTokenizer {
  /** Custom inline rules indexed by trigger char code */
  private customCharMap: Map<number, ResolvedInlineRule[]>
  /** Custom inline rules without trigger chars (checked as fallback) */
  private customGeneralRules: ResolvedInlineRule[]
  /** Text pattern adapted for custom rule trigger chars */
  private textPattern: RegExp
  /** Inline tokenizer options */
  private inlineOptions: InlineTokenizerOptions

  constructor(customRules: InlineRule[] = [], options: InlineTokenizerOptions = {}) {
    this.inlineOptions = options
    this.customCharMap = new Map()
    this.customGeneralRules = []

    const triggerCharSet = new Set<number>()
    let hasGeneralRules = false

    for (const [order, rule] of customRules.entries()) {
      const resolved = {
        rule,
        priority: this.resolveRulePriority(rule),
        order,
      }
      if (rule.triggerChars && rule.triggerChars.length > 0) {
        for (const charCode of rule.triggerChars) {
          triggerCharSet.add(charCode)
          const existing = this.customCharMap.get(charCode)
          if (existing) {
            existing.push(resolved)
          } else {
            this.customCharMap.set(charCode, [resolved])
          }
        }
      } else {
        hasGeneralRules = true
        this.customGeneralRules.push(resolved)
      }
    }

    const byPriority = (left: ResolvedInlineRule, right: ResolvedInlineRule): number => (
      right.priority - left.priority || left.order - right.order
    )
    this.customGeneralRules.sort(byPriority)
    for (const rules of this.customCharMap.values()) rules.sort(byPriority)

    // Build text pattern that stops at custom trigger chars
    if (hasGeneralRules) {
      // General rules need single-char text matching to get a chance at every position
      this.textPattern = /^(?:(?!https?:\/\/|ftp:\/\/|www\.)[^*_`[<\n\\!~])/i
    } else if (triggerCharSet.size > 0) {
      // Add trigger chars to the exclusion set so text doesn't consume them
      const extra = [...triggerCharSet]
        .map((c) => `\\u${c.toString(16).padStart(4, '0')}`)
        .join('')
      this.textPattern = new RegExp(
        `^(?:(?!https?:\\/\\/|ftp:\\/\\/|www\\.)[^*_\`[<\\n\\\\!~${extra}])+`,
        'i'
      )
    } else {
      this.textPattern = PATTERNS.text
    }
  }

  /**
   * Tokenize inline markdown string
   * Phase 6: Optimized with fast-path checks to avoid unnecessary regex execution
   *
   * @param src - Inline markdown source
   * @returns Array of inline tokens
   */
  tokenize(
    src: string,
    references: ReadonlyMap<string, LinkReference> = new Map()
  ): InlineToken[] {
    const tokens: InlineToken[] = []
    const linkScan = this.createLinkScan(src)
    let cursor = 0
    let previousChar = ''

    while (cursor < src.length) {
      const char = src.charCodeAt(cursor)
      const token = this.tokenizeAt(src, cursor, char, references, previousChar, linkScan)

      if (token) {
        this.assertProgress('inline tokenizer', src, cursor, token.raw)
        tokens.push(token.token)
        previousChar = token.raw.at(-1) ?? previousChar
        cursor += token.raw.length
      } else {
        if (
          char === 91
          && this.customCharMap.size === 0
          && this.customGeneralRules.length === 0
          && this.findPosition(linkScan.closingBrackets, cursor + 1) === -1
        ) {
          let end = cursor + 1
          while (src.charCodeAt(end) === 91) end++
          const raw = src.slice(cursor, end)
          tokens.push({ type: 'text', raw, text: raw })
          previousChar = '['
          cursor = end
          continue
        }

        tokens.push({
          type: 'text',
          raw: src[cursor],
          text: src[cursor],
        })
        previousChar = src[cursor]
        cursor++
      }
    }

    return tokens
  }

  private resolveRulePriority(rule: InlineRule): number {
    if (rule.priority === undefined) return DEFAULT_CUSTOM_PRIORITY
    if (typeof rule.priority === 'number') {
      return Number.isFinite(rule.priority) ? rule.priority : DEFAULT_CUSTOM_PRIORITY
    }

    const separator = rule.priority.indexOf(':')
    const position = rule.priority.slice(0, separator)
    const targetName = rule.priority.slice(separator + 1)
    const target = INLINE_RULE_PRIORITIES[targetName]
    if (target === undefined) return DEFAULT_CUSTOM_PRIORITY
    return position === 'before' ? target + 1 : target - 1
  }

  private tokenizeAt(
    source: string,
    cursor: number,
    char: number,
    references: ReadonlyMap<string, LinkReference>,
    previousChar: string,
    linkScan: LinkScan
  ): InlineResult | null {
    const customRules = this.getCustomRules(char)
    let customIndex = 0
    let remaining: string | undefined
    const src = (): string => (remaining ??= source.slice(cursor))

    const tryCustomBefore = (priority: number): InlineResult | null => {
      while (customIndex < customRules.length && customRules[customIndex].priority > priority) {
        const candidate = customRules[customIndex++]
        const result = candidate.rule.tokenize(src())
        if (result) {
          this.assertProgress(candidate.rule.name, source, cursor, result.raw)
          return result
        }
      }
      return null
    }

    const tryBuiltin = (priority: number, tokenize: () => InlineResult | null): InlineResult | null => (
      tryCustomBefore(priority) || tokenize()
    )

    let result: InlineResult | null = null

    if (char === 92) {
      result = tryBuiltin(INLINE_RULE_PRIORITIES['escape'], () => this.tokenizeEscape(src()))
    } else if (char === 96) {
      result = tryBuiltin(INLINE_RULE_PRIORITIES['code'], () => this.tokenizeCode(src()))
    } else if (char === 42 || char === 95) {
      result = tryBuiltin(
        INLINE_RULE_PRIORITIES['strong'],
        () => this.tokenizeStrong(src(), references, previousChar)
      )
      if (!result) {
        result = tryBuiltin(
          INLINE_RULE_PRIORITIES['em'],
          () => this.tokenizeEm(src(), references, previousChar)
        )
      }
    } else if (char === 126 && this.inlineOptions.gfm !== false) {
      result = tryBuiltin(
        INLINE_RULE_PRIORITIES['del'],
        () => this.tokenizeDel(src(), references)
      )
    } else if (char === 33 || char === 91) {
      result = tryBuiltin(
        INLINE_RULE_PRIORITIES['link'],
        () => this.tokenizeLink(source, cursor, references, linkScan)
      )
    } else if (char === 60) {
      result = tryBuiltin(
        INLINE_RULE_PRIORITIES['angleAutolink'],
        () => this.tokenizeAngleAutolink(src())
      )
      if (!result && this.inlineOptions.allowHtml) {
        result = tryBuiltin(INLINE_RULE_PRIORITIES['html'], () => this.tokenizeHtml(src()))
      }
    } else if (
      (char === 32 && source.charCodeAt(cursor + 1) === 32)
      || (char === 10 && this.inlineOptions.breaks)
    ) {
      result = tryBuiltin(INLINE_RULE_PRIORITIES['br'], () => this.tokenizeBr(src()))
    }
    if (result) return result

    if (
      this.inlineOptions.gfm !== false
      && (char === 72 || char === 104 || char === 70 || char === 102 || char === 87 || char === 119)
    ) {
      result = tryBuiltin(INLINE_RULE_PRIORITIES['autolink'], () => this.tokenizeAutolink(src()))
      if (result) return result
    }

    if (!'*_`[<\n\\!~'.includes(source[cursor])) {
      result = tryBuiltin(INLINE_RULE_PRIORITIES['text'], () => this.tokenizeText(src()))
      if (result) return result
    } else {
      result = tryCustomBefore(INLINE_RULE_PRIORITIES['text'])
      if (result) return result
    }

    while (customIndex < customRules.length) {
      const candidate = customRules[customIndex++]
      result = candidate.rule.tokenize(src())
      if (result) {
        this.assertProgress(candidate.rule.name, source, cursor, result.raw)
        return result
      }
    }
    return null
  }

  private getCustomRules(char: number): ResolvedInlineRule[] {
    const charRules = this.customCharMap.get(char) ?? []
    if (charRules.length === 0) return this.customGeneralRules
    if (this.customGeneralRules.length === 0) return charRules

    return [...charRules, ...this.customGeneralRules].sort((left, right) => (
      right.priority - left.priority || left.order - right.order
    ))
  }

  private assertProgress(ruleName: string, src: string, cursor: number, raw: string): void {
    if (typeof raw !== 'string' || raw.length === 0) {
      throw new TypeError(`Inline rule "${ruleName}" must consume a non-empty prefix`)
    }
    if (!src.startsWith(raw, cursor)) {
      throw new TypeError(`Inline rule "${ruleName}" returned raw text that is not a source prefix`)
    }
  }

  private createLinkScan(src: string): LinkScan {
    const closingBrackets: number[] = []
    const openingAngles: number[] = []
    const closingAngles: number[] = []
    const whitespaces: number[] = []
    const doubleQuotes: number[] = []
    const singleQuotes: number[] = []
    const matchingParentheses = new Map<number, number>()
    const parenthesisStack: number[] = []
    let parenthesisBalance = new Int32Array(0)
    let trackDirectSyntax = false
    let escaped = false

    for (let index = 0; index < src.length; index++) {
      const char = src.charCodeAt(index)
      if (trackDirectSyntax) {
        parenthesisBalance[index + 1] = parenthesisBalance[index]
      }

      if (trackDirectSyntax && InlineTokenizer.isWhitespace(char)) {
        whitespaces.push(index)
      }

      if (escaped) {
        escaped = false
      } else if (char === 92) {
        escaped = true
      } else {
        if (char === 93) {
          closingBrackets.push(index)
          if (!trackDirectSyntax && src.charCodeAt(index + 1) === 40) {
            trackDirectSyntax = true
            parenthesisBalance = new Int32Array(src.length + 1)
          }
        } else if (trackDirectSyntax && char === 60) openingAngles.push(index)
        else if (trackDirectSyntax && char === 62) closingAngles.push(index)
        else if (trackDirectSyntax && char === 34) doubleQuotes.push(index)
        else if (trackDirectSyntax && char === 39) singleQuotes.push(index)
        else if (trackDirectSyntax && char === 40) {
          parenthesisStack.push(index)
          parenthesisBalance[index + 1]++
        } else if (trackDirectSyntax && char === 41) {
          const opening = parenthesisStack.pop()
          if (opening !== undefined) matchingParentheses.set(opening, index)
          parenthesisBalance[index + 1]--
        }
      }
    }

    return {
      closingBrackets,
      openingAngles,
      closingAngles,
      whitespaces,
      doubleQuotes,
      singleQuotes,
      matchingParentheses,
      parenthesisBalance,
      destinations: new Map(),
    }
  }

  private findPosition(positions: number[], minimum: number): number {
    let low = 0
    let high = positions.length

    while (low < high) {
      const middle = low + Math.floor((high - low) / 2)
      if (positions[middle] < minimum) low = middle + 1
      else high = middle
    }

    return positions[low] ?? -1
  }

  /**
   * Tokenize escape sequence
   */
  private tokenizeEscape(src: string): { token: InlineToken; raw: string } | null {
    const match = PATTERNS.escape.exec(src)
    if (!match) return null

    const raw = match[0]
    const text = match[1]

    return {
      token: {
        type: 'text',
        raw,
        text,
      },
      raw,
    }
  }

  /**
   * Tokenize inline code
   */
  private tokenizeCode(src: string): { token: InlineToken; raw: string } | null {
    const match = PATTERNS.code.exec(src)
    if (!match) return null

    const raw = match[0]
    const delimiterLength = match[1].length
    let text = raw.slice(delimiterLength, -delimiterLength).replace(/\r?\n/g, ' ')
    if (text.startsWith(' ') && text.endsWith(' ') && /[^ ]/.test(text)) {
      text = text.slice(1, -1)
    }

    return {
      token: {
        type: 'code',
        raw,
        text,
      },
      raw,
    }
  }

  /**
   * Tokenize strong (bold)
   */
  private tokenizeStrong(
    src: string,
    references: ReadonlyMap<string, LinkReference>,
    previousChar: string
  ): { token: InlineToken; raw: string } | null {
    // Try ** or __ delimiters
    if (src.startsWith('**')) {
      const result = this.findClosingDelimiter(src, '**', 2)
      if (result) {
        const { content, raw } = result
        const tokens = this.tokenize(content, references)
        return {
          token: {
            type: 'strong',
            raw,
            text: content,
            tokens,
          },
          raw,
        }
      }
    }

    if (src.startsWith('__')) {
      if (/[\p{L}\p{N}]/u.test(previousChar) && /[\p{L}\p{N}]/u.test(src[2] ?? '')) {
        return null
      }
      const result = this.findClosingDelimiter(src, '__', 2)
      if (result) {
        const { content, raw } = result
        const tokens = this.tokenize(content, references)
        return {
          token: {
            type: 'strong',
            raw,
            text: content,
            tokens,
          },
          raw,
        }
      }
    }

    return null
  }

  /**
   * Tokenize emphasis (italic)
   */
  private tokenizeEm(
    src: string,
    references: ReadonlyMap<string, LinkReference>,
    previousChar: string
  ): { token: InlineToken; raw: string } | null {
    // Try * or _ delimiters (but not ** or __)
    if (src.startsWith('*') && !src.startsWith('**')) {
      const result = this.findClosingDelimiter(src, '*', 1)
      if (result) {
        const { content, raw } = result
        const tokens = this.tokenize(content, references)
        return {
          token: {
            type: 'em',
            raw,
            text: content,
            tokens,
          },
          raw,
        }
      }
    }

    if (src.startsWith('_') && !src.startsWith('__')) {
      if (/[\p{L}\p{N}]/u.test(previousChar) && /[\p{L}\p{N}]/u.test(src[1] ?? '')) {
        return null
      }
      const result = this.findClosingDelimiter(src, '_', 1)
      if (result) {
        const { content, raw } = result
        const tokens = this.tokenize(content, references)
        return {
          token: {
            type: 'em',
            raw,
            text: content,
            tokens,
          },
          raw,
        }
      }
    }

    return null
  }

  /**
   * Tokenize strikethrough (del)
   * Phase 4: GFM extension for ~~strikethrough~~
   */
  private tokenizeDel(
    src: string,
    references: ReadonlyMap<string, LinkReference>
  ): { token: InlineToken; raw: string } | null {
    const match = PATTERNS.del.exec(src)
    if (!match) return null

    const raw = match[0]
    const text = match[1]

    // Recursively tokenize content
    const tokens = this.tokenize(text, references)

    return {
      token: {
        type: 'del',
        raw,
        text,
        tokens,
      },
      raw,
    }
  }

  /**
   * Find closing delimiter for emphasis/strong
   * Handles nested delimiters correctly by using the appropriate part of delimiter runs
   *
   * Phase 2: Proper delimiter matching for nested emphasis
   * Key insight: For runs like ***, we use the LAST delimiters to close outer emphasis,
   * leaving the FIRST delimiters for inner emphasis
   */
  private findClosingDelimiter(
    src: string,
    delimiter: string,
    delimiterLength: number
  ): { content: string; raw: string } | null {
    // Must start with delimiter
    if (!src.startsWith(delimiter)) return null

    // Content must start with non-whitespace
    if (delimiterLength >= src.length || /^\s/.test(src[delimiterLength])) {
      return null
    }

    const char = delimiter[0]
    let i = delimiterLength

    while (i < src.length) {
      // Skip escaped characters
      if (src[i] === '\\' && i + 1 < src.length) {
        i += 2
        continue
      }

      // Check if we found the delimiter character
      if (src[i] === char) {
        // Count how many consecutive delimiter chars we have
        let runLength = 0
        while (i + runLength < src.length && src[i + runLength] === char) {
          runLength++
        }

        const prevChar = i > 0 ? src[i - 1] : ' '
        const nextChar = src[i + runLength] ?? ''

        // Content must end with non-whitespace
        if (!/\S/.test(prevChar)) {
          i += runLength
          continue
        }

        if (
          char === '_'
          && /[\p{L}\p{N}]/u.test(prevChar)
          && /[\p{L}\p{N}]/u.test(nextChar)
        ) {
          i += runLength
          continue
        }

        // Can we use this delimiter run to close?
        // Phase 3: Improved handling for triple delimiters
        // Key insight: For ***, we use delimiterLength chars to close,
        // and include the REMAINING chars in the content for recursive parsing
        //
        // Examples:
        // - **bold *italic*** → close ** using first 2 of ***, leave last * in content
        // - *italic **bold*** → close * using last 1 of ***, leave first 2 ** in content

        if (runLength >= delimiterLength) {
          if (delimiterLength === 1) {
            // For single *, can match length 1 or 3+
            // Length 2 is reserved for **
            if (runLength === 1) {
              // Exact match: * closes *
              const content = src.slice(delimiterLength, i)
              const raw = src.slice(0, i + 1)
              return { content, raw }
            } else if (runLength >= 3) {
              // For ***, use the LAST * to close, include the rest in content
              // This allows **bold** inside to be parsed
              const contentEnd = i + runLength - 1
              const content = src.slice(delimiterLength, contentEnd)
              // Consume ALL of the delimiter run in raw (including extras)
              const raw = src.slice(0, i + runLength)
              return { content, raw }
            }
            // runLength === 2: skip, it's for **
          } else if (delimiterLength === 2) {
            // For **, can match length 2 or 3+
            if (runLength === 2) {
              // Exact match: ** closes **
              const content = src.slice(delimiterLength, i)
              const raw = src.slice(0, i + 2)
              return { content, raw }
            } else if (runLength >= 3) {
              // For ***, use the FIRST 2 * to close **, include the rest in content
              // This allows *italic* inside to be parsed
              const contentEnd = i + runLength - delimiterLength
              const content = src.slice(delimiterLength, contentEnd)
              // Consume ALL of the delimiter run in raw (including extras)
              const raw = src.slice(0, i + runLength)
              return { content, raw }
            }
          }
        }

        // This delimiter run is too short, skip it
        i += runLength
      } else {
        i++
      }
    }

    return null
  }

  /**
   * Tokenize extended autolink (GFM - Phase 4)
   * Phase 6: Optimized to reduce string operations and allocations
   * Automatically converts URLs to links
   */
  private tokenizeAutolink(src: string): { token: InlineToken; raw: string } | null {
    const match = PATTERNS.autolink.exec(src)
    if (!match) return null

    let raw = match[0]

    // GFM excludes trailing punctuation from extended autolinks.
    raw = raw.replace(/[?!.,:*_~]+$/, '')

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

    const text = raw

    // Optimized: check first char instead of startsWith
    const href = /^www\./i.test(raw) ? 'http://' + raw : raw

    // Create link token (reuse raw string where possible)
    return {
      token: {
        type: 'link',
        raw,
        href,
        text,
        tokens: [
          {
            type: 'text',
            raw,
            text,
          },
        ],
      },
      raw,
    }
  }

  /** Tokenize CommonMark URI and email autolinks enclosed in angle brackets. */
  private tokenizeAngleAutolink(src: string): InlineResult | null {
    const uri = PATTERNS.angleUri.exec(src)
    const email = uri ? null : PATTERNS.angleEmail.exec(src)
    const match = uri ?? email
    if (!match) return null

    const raw = match[0]
    const text = match[1]
    let href = email ? `mailto:${text}` : text
    if (!email) {
      try {
        href = encodeURI(href)
      } catch {
        // A lone surrogate cannot be URI-encoded. The renderer still escapes it.
      }
    }

    return {
      token: {
        type: 'link',
        raw,
        href,
        text,
        tokens: [{ type: 'text', raw: text, text }],
      },
      raw,
    }
  }

  /**
   * Tokenize link or image
   */
  private tokenizeLink(
    src: string,
    cursor: number,
    references: ReadonlyMap<string, LinkReference>,
    linkScan: LinkScan
  ): { token: InlineToken; raw: string } | null {
    const isImage = src.charCodeAt(cursor) === 33
    const openBracket = cursor + (isImage ? 1 : 0)
    if (src.charCodeAt(openBracket) !== 91) return null

    const closingBracket = this.findPosition(
      linkScan.closingBrackets,
      openBracket + 1
    )
    if (closingBracket === -1) return null

    const text = src.slice(openBracket + 1, closingBracket)
    if (src.charCodeAt(closingBracket + 1) !== 40) {
      return this.tokenizeReferenceLink(
        src,
        cursor,
        closingBracket,
        text,
        isImage,
        references,
        linkScan
      )
    }

    let destination = linkScan.destinations.get(closingBracket)
    if (destination === undefined) {
      destination = this.parseLinkDestination(src, closingBracket + 2, linkScan)
      linkScan.destinations.set(closingBracket, destination)
    }
    if (!destination) return null

    const raw = src.slice(cursor, destination.end)
    const { href, title } = destination

    if (isImage) {
      return {
        token: {
          type: 'image',
          raw,
          href,
          title,
          text,
        },
        raw,
      }
    }

    // Recursively tokenize link text
    const tokens = this.tokenize(text, references)

    return {
      token: {
        type: 'link',
        raw,
        href,
        title,
        text,
        tokens,
      },
      raw,
    }
  }

  private tokenizeReferenceLink(
    src: string,
    cursor: number,
    closingBracket: number,
    text: string,
    isImage: boolean,
    references: ReadonlyMap<string, LinkReference>,
    linkScan: LinkScan
  ): { token: InlineToken; raw: string } | null {
    if (!text || text.length > 999 || text.includes('\n')) return null

    let end = closingBracket + 1
    let label = text
    if (src.charCodeAt(end) === 91) {
      const explicitClosingBracket = this.findPosition(
        linkScan.closingBrackets,
        end + 1
      )
      if (explicitClosingBracket === -1) return null

      const explicitLabel = src.slice(end + 1, explicitClosingBracket)
      if (explicitLabel.length > 999 || explicitLabel.includes('\n')) return null
      if (explicitLabel) label = explicitLabel
      end = explicitClosingBracket + 1
    }

    const reference = references.get(InlineTokenizer.normalizeReferenceLabel(label))
    if (!reference) return null

    const raw = src.slice(cursor, end)
    if (isImage) {
      return {
        token: { type: 'image', raw, text, href: reference.href, title: reference.title },
        raw,
      }
    }

    return {
      token: {
        type: 'link',
        raw,
        text,
        href: reference.href,
        title: reference.title,
        tokens: this.tokenize(text, references),
      },
      raw,
    }
  }

  private parseLinkDestination(
    src: string,
    start: number,
    linkScan: LinkScan
  ): ParsedLinkDestination | null {
    let cursor = start
    let href = ''

    if (src.charCodeAt(cursor) === 60) {
      const hrefStart = cursor + 1
      const hrefEnd = this.findPosition(linkScan.closingAngles, hrefStart)
      if (hrefEnd === -1) return null

      const nestedOpening = this.findPosition(linkScan.openingAngles, hrefStart)
      if (nestedOpening !== -1 && nestedOpening < hrefEnd) return null

      const lineBreak = this.findPosition(linkScan.whitespaces, hrefStart)
      if (lineBreak !== -1 && lineBreak < hrefEnd) return null

      href = src.slice(hrefStart, hrefEnd)
      cursor = hrefEnd + 1
    } else {
      const outerOpening = start - 1
      const outerClosing = linkScan.matchingParentheses.get(outerOpening)
      const whitespace = this.findPosition(linkScan.whitespaces, start)

      if (
        outerClosing !== undefined
        && (whitespace === -1 || outerClosing < whitespace)
      ) {
        href = InlineTokenizer.unescapePunctuation(src.slice(start, outerClosing))
        return { end: outerClosing + 1, href }
      }

      if (whitespace === -1) return null
      const balance = (
        linkScan.parenthesisBalance[whitespace]
        - linkScan.parenthesisBalance[start]
      )
      if (balance !== 0) return null

      href = src.slice(start, whitespace)
      cursor = whitespace
    }

    href = InlineTokenizer.unescapePunctuation(href)
    if (src.charCodeAt(cursor) === 41) return { end: cursor + 1, href }
    if (!InlineTokenizer.isWhitespace(src.charCodeAt(cursor))) return null

    while (InlineTokenizer.isWhitespace(src.charCodeAt(cursor))) cursor++
    if (src.charCodeAt(cursor) === 41) return { end: cursor + 1, href }

    const titleOpener = src[cursor]
    if (titleOpener !== '"' && titleOpener !== "'" && titleOpener !== '(') return null

    const titleStart = ++cursor
    const titleEnd = titleOpener === '"'
      ? this.findPosition(linkScan.doubleQuotes, titleStart)
      : titleOpener === "'"
        ? this.findPosition(linkScan.singleQuotes, titleStart)
        : linkScan.matchingParentheses.get(titleStart - 1) ?? -1
    if (titleEnd === -1) return null

    const title = InlineTokenizer.unescapePunctuation(src.slice(titleStart, titleEnd))
    cursor = titleEnd + 1
    while (InlineTokenizer.isWhitespace(src.charCodeAt(cursor))) cursor++
    if (src.charCodeAt(cursor) !== 41) return null

    return { end: cursor + 1, href, title }
  }

  private static isWhitespace(char: number): boolean {
    return char === 32 || char === 9 || char === 10 || char === 13
  }

  private static unescapePunctuation(value: string): string {
    return value.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g, '$1')
  }

  private tokenizeHtml(src: string): { token: InlineToken; raw: string } | null {
    const match = PATTERNS.html.exec(src)
    if (!match) return null
    const raw = match[0]
    return { token: { type: 'html', raw, text: raw }, raw }
  }

  static normalizeReferenceLabel(label: string): string {
    return label.trim().replace(/\s+/g, ' ').toLowerCase()
  }

  /**
   * Tokenize line break
   * Supports both standard (two spaces + newline) and GFM breaks (bare newline)
   */
  private tokenizeBr(src: string): { token: InlineToken; raw: string } | null {
    // When breaks: true, a bare newline also produces <br>
    if (this.inlineOptions.breaks && src.charCodeAt(0) === 10) { // '\n'
      // Don't match if followed by only whitespace (end of block)
      if (/^\n\s*$/.test(src)) return null
      return {
        token: { type: 'br', raw: '\n' },
        raw: '\n',
      }
    }

    const match = PATTERNS.br.exec(src)
    if (!match) return null

    const raw = match[0]

    return {
      token: {
        type: 'br',
        raw,
      },
      raw,
    }
  }

  /**
   * Tokenize plain text
   * Uses instance textPattern which may exclude custom trigger chars
   */
  private tokenizeText(src: string): { token: InlineToken; raw: string } | null {
    const match = this.textPattern.exec(src)
    if (!match) return null

    const raw = match[0]
    const text = raw

    return {
      token: {
        type: 'text',
        raw,
        text,
      },
      raw,
    }
  }
}
