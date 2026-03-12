/**
 * Inline tokenizer for parsing inline markdown elements
 */

import type { InlineToken } from './types.js'

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
  autolink: /^((?:https?:\/\/|www\.)[^\s<]+)/,

  // Link ![alt](url "title") or [text](url "title")
  // Greedy match to handle URLs with parens (e.g., javascript:alert(1))
  link: /^!?\[([^\]]*)\]\(([^\s]+)(?:\s+"([^"]*)")?\)/,

  // Line break (two spaces + newline)
  br: /^ {2,}\n(?!\s*$)/,

  // Plain text (everything else)
  // Phase 6: Keep negative lookahead for autolinks (necessary for correct parsing)
  text: /^(?:(?!https?:\/\/|www\.)[^*_`[\n\\!~])+/,
}

/**
 * Inline tokenizer class
 */
export class InlineTokenizer {
  /**
   * Tokenize inline markdown string
   * Phase 6: Optimized with fast-path checks to avoid unnecessary regex execution
   *
   * @param src - Inline markdown source
   * @returns Array of inline tokens
   */
  tokenize(src: string): InlineToken[] {
    const tokens: InlineToken[] = []
    let text = src

    while (text) {
      // Phase 6: Fast-path checks using character codes to avoid regex overhead
      const char = text.charCodeAt(0)
      let token = null

      // Check for common patterns first using character codes
      // This avoids running regex on every character

      if (char === 92) { // '\' - escape
        token = this.tokenizeEscape(text)
      } else if (char === 96) { // '`' - code
        token = this.tokenizeCode(text)
      } else if (char === 42 || char === 95) { // '*' or '_' - strong/em
        // Check for strong first (higher precedence)
        if (text.charCodeAt(1) === char) { // double char like ** or __
          token = this.tokenizeStrong(text)
        }
        if (!token) {
          token = this.tokenizeEm(text)
        }
      } else if (char === 126) { // '~' - strikethrough
        if (text.charCodeAt(1) === 126) { // ~~
          token = this.tokenizeDel(text)
        }
      } else if (char === 33 || char === 91) { // '!' or '[' - link
        token = this.tokenizeLink(text)
      } else if (char === 32 && text.charCodeAt(1) === 32) { // two spaces - potential line break
        token = this.tokenizeBr(text)
      }

      // If no specific token matched, check autolinks then text pattern
      // Autolinks can start anywhere, so we check them before text
      if (!token) {
        token = this.tokenizeAutolink(text) || this.tokenizeText(text)
      }

      if (token) {
        tokens.push(token.token)
        text = text.slice(token.raw.length)
      } else {
        // Skip single character if no match
        tokens.push({
          type: 'text',
          raw: text[0],
          text: text[0],
        })
        text = text.slice(1)
      }
    }

    return tokens
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
  private tokenizeStrong(src: string): { token: InlineToken; raw: string } | null {
    // Try ** or __ delimiters
    if (src.startsWith('**')) {
      const result = this.findClosingDelimiter(src, '**', 2)
      if (result) {
        const { content, raw } = result
        const tokens = this.tokenize(content)
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
      const result = this.findClosingDelimiter(src, '__', 2)
      if (result) {
        const { content, raw } = result
        const tokens = this.tokenize(content)
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
  private tokenizeEm(src: string): { token: InlineToken; raw: string } | null {
    // Try * or _ delimiters (but not ** or __)
    if (src.startsWith('*') && !src.startsWith('**')) {
      const result = this.findClosingDelimiter(src, '*', 1)
      if (result) {
        const { content, raw } = result
        const tokens = this.tokenize(content)
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
      const result = this.findClosingDelimiter(src, '_', 1)
      if (result) {
        const { content, raw } = result
        const tokens = this.tokenize(content)
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
  private tokenizeDel(src: string): { token: InlineToken; raw: string } | null {
    const match = PATTERNS.del.exec(src)
    if (!match) return null

    const raw = match[0]
    const text = match[1]

    // Recursively tokenize content
    const tokens = this.tokenize(text)

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

        // Content must end with non-whitespace
        if (!/\S/.test(prevChar)) {
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

    const raw = match[0]
    const text = raw

    // Optimized: check first char instead of startsWith
    const href = raw.charCodeAt(0) === 119 ? 'http://' + raw : raw // 119 = 'w'

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
  private tokenizeLink(src: string): { token: InlineToken; raw: string } | null {
    const match = PATTERNS.link.exec(src)
    if (!match) return null

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
    const tokens = this.tokenize(text)

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

  /**
   * Tokenize line break
   */
  private tokenizeBr(src: string): { token: InlineToken; raw: string } | null {
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
   */
  private tokenizeText(src: string): { token: InlineToken; raw: string } | null {
    const match = PATTERNS.text.exec(src)
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
