/**
 * Main markdown parser
 */

import type { Parser, ParserOptions, BlockToken, ParagraphToken, HeadingToken, TableToken } from './types.js'
import { Tokenizer } from './tokenizer.js'
import { InlineTokenizer } from './inline-tokenizer.js'
import { HtmlRenderer } from './renderer.js'

/**
 * Markdown parser implementation
 */
export class MarkdownParser implements Parser {
  private options: ParserOptions
  private blockTokenizer: Tokenizer
  private inlineTokenizer: InlineTokenizer
  private renderer: HtmlRenderer

  constructor(options: ParserOptions = {}) {
    this.options = {
      allowHtml: false,
      sanitize: false,
      gfm: false,
      breaks: false,
      ...options,
    }

    this.blockTokenizer = new Tokenizer(this.options)
    this.inlineTokenizer = new InlineTokenizer()
    this.renderer = new HtmlRenderer()
  }

  /**
   * Parse markdown to HTML
   *
   * @param markdown - Markdown source string
   * @returns HTML string
   */
  parse(markdown: string): string {
    const tokens = this.tokenize(markdown)
    return this.render(tokens)
  }

  /**
   * Tokenize markdown to block tokens
   *
   * @param markdown - Markdown source string
   * @returns Array of block tokens
   */
  tokenize(markdown: string): BlockToken[] {
    const blockTokens = this.blockTokenizer.tokenize(markdown)

    // Parse inline content recursively
    return this.processInlineTokens(blockTokens)
  }

  /**
   * Recursively process inline tokens for all block tokens
   *
   * @param tokens - Array of block tokens
   * @returns Array of block tokens with inline tokens processed
   */
  private processInlineTokens(tokens: BlockToken[]): BlockToken[] {
    return tokens.map((token) => {
      if (token.type === 'paragraph') {
        return {
          ...token,
          tokens: this.inlineTokenizer.tokenize(token.text),
        } as ParagraphToken
      }

      if (token.type === 'heading') {
        return {
          ...token,
          tokens: this.inlineTokenizer.tokenize(token.text),
        } as HeadingToken
      }

      if (token.type === 'blockquote') {
        return {
          ...token,
          tokens: this.processInlineTokens(token.tokens),
        }
      }

      if (token.type === 'list') {
        return {
          ...token,
          items: token.items.map((item) => ({
            ...item,
            tokens: this.processInlineTokens(item.tokens),
          })),
        }
      }

      if (token.type === 'table') {
        return {
          ...token,
          header: token.header.map((cell) => ({
            ...cell,
            tokens: this.inlineTokenizer.tokenize(cell.text),
          })),
          rows: token.rows.map((row) =>
            row.map((cell) => ({
              ...cell,
              tokens: this.inlineTokenizer.tokenize(cell.text),
            }))
          ),
        } as TableToken
      }

      return token
    })
  }

  /**
   * Render tokens to HTML
   *
   * @param tokens - Array of block tokens
   * @returns HTML string
   */
  render(tokens: BlockToken[]): string {
    return this.renderer.renderBlock(tokens)
  }
}

/**
 * Create a new parser instance
 *
 * @param options - Parser options
 * @returns Parser instance
 */
export function createParser(options?: ParserOptions): Parser {
  return new MarkdownParser(options)
}
