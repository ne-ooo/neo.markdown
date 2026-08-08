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

  // Link ![alt](url "title") or [text](url "title")
  // Greedy match to handle URLs with parens (e.g., javascript:alert(1))
  link: /^!?\[([^\]]*)\]\(([^\s]+)(?:\s+"([^"]*)")?\)/,

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
  html: 550,
  br: 500,
  autolink: 400,
  text: 0,
}
const DEFAULT_CUSTOM_PRIORITY = 750

type InlineResult = { token: InlineToken; raw: string }

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
    let cursor = 0
    let previousChar = ''

    while (cursor < src.length) {
      const text = src.slice(cursor)
      const char = text.charCodeAt(0)
      const token = this.tokenizeAt(text, char, references, previousChar)

      if (token) {
        this.assertProgress('inline tokenizer', text, token.raw)
        tokens.push(token.token)
        previousChar = token.raw.at(-1) ?? previousChar
        cursor += token.raw.length
      } else {
        tokens.push({
          type: 'text',
          raw: text[0],
          text: text[0],
        })
        previousChar = text[0]
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
    src: string,
    char: number,
    references: ReadonlyMap<string, LinkReference>,
    previousChar: string
  ): InlineResult | null {
    const customRules = this.getCustomRules(char)
    let customIndex = 0

    const tryCustomBefore = (priority: number): InlineResult | null => {
      while (customIndex < customRules.length && customRules[customIndex].priority > priority) {
        const candidate = customRules[customIndex++]
        const result = candidate.rule.tokenize(src)
        if (result) {
          this.assertProgress(candidate.rule.name, src, result.raw)
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
      result = tryBuiltin(INLINE_RULE_PRIORITIES['escape'], () => this.tokenizeEscape(src))
    } else if (char === 96) {
      result = tryBuiltin(INLINE_RULE_PRIORITIES['code'], () => this.tokenizeCode(src))
    } else if (char === 42 || char === 95) {
      result = tryBuiltin(
        INLINE_RULE_PRIORITIES['strong'],
        () => this.tokenizeStrong(src, references, previousChar)
      )
      if (!result) {
        result = tryBuiltin(
          INLINE_RULE_PRIORITIES['em'],
          () => this.tokenizeEm(src, references, previousChar)
        )
      }
    } else if (char === 126 && this.inlineOptions.gfm !== false) {
      result = tryBuiltin(
        INLINE_RULE_PRIORITIES['del'],
        () => this.tokenizeDel(src, references)
      )
    } else if (char === 33 || char === 91) {
      result = tryBuiltin(
        INLINE_RULE_PRIORITIES['link'],
        () => this.tokenizeLink(src, references)
      )
    } else if (char === 60 && this.inlineOptions.allowHtml) {
      result = tryBuiltin(INLINE_RULE_PRIORITIES['html'], () => this.tokenizeHtml(src))
    } else if (
      (char === 32 && src.charCodeAt(1) === 32)
      || (char === 10 && this.inlineOptions.breaks)
    ) {
      result = tryBuiltin(INLINE_RULE_PRIORITIES['br'], () => this.tokenizeBr(src))
    }
    if (result) return result

    if (this.inlineOptions.gfm !== false) {
      result = tryBuiltin(INLINE_RULE_PRIORITIES['autolink'], () => this.tokenizeAutolink(src))
      if (result) return result
    }

    result = tryBuiltin(INLINE_RULE_PRIORITIES['text'], () => this.tokenizeText(src))
    if (result) return result

    while (customIndex < customRules.length) {
      const candidate = customRules[customIndex++]
      result = candidate.rule.tokenize(src)
      if (result) {
        this.assertProgress(candidate.rule.name, src, result.raw)
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

  private assertProgress(ruleName: string, src: string, raw: string): void {
    if (typeof raw !== 'string' || raw.length === 0) {
      throw new TypeError(`Inline rule "${ruleName}" must consume a non-empty prefix`)
    }
    if (!src.startsWith(raw)) {
      throw new TypeError(`Inline rule "${ruleName}" returned raw text that is not a source prefix`)
    }
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
    const text = match[2].trim()

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

  /**
   * Tokenize link or image
   */
  private tokenizeLink(
    src: string,
    references: ReadonlyMap<string, LinkReference>
  ): { token: InlineToken; raw: string } | null {
    const match = PATTERNS.link.exec(src)
    if (!match) return this.tokenizeReferenceLink(src, references)

    const raw = match[0]
    const isImage = raw.startsWith('!')
    const text = match[1]
    const href = match[2]
    const title = match[3] || undefined

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
    references: ReadonlyMap<string, LinkReference>
  ): { token: InlineToken; raw: string } | null {
    const match = /^(!?)\[([^\]\n]+)\](?:\[([^\]\n]*)\])?/.exec(src)
    if (!match) return null

    const text = match[2]
    const explicitLabel = match[3]
    const label = explicitLabel === undefined || explicitLabel === '' ? text : explicitLabel
    const reference = references.get(InlineTokenizer.normalizeReferenceLabel(label))
    if (!reference) return null

    const raw = match[0]
    if (match[1] === '!') {
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
