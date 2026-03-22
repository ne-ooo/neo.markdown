/**
 * Main markdown parser
 */

import type { Parser, ParserOptions, BlockToken, ParagraphToken, HeadingToken, TableToken } from './types.js'
import { Tokenizer } from './tokenizer.js'
import { InlineTokenizer } from './inline-tokenizer.js'
import { HtmlRenderer } from './renderer.js'
import { PluginBuilderImpl } from './plugin-builder.js'
import { sanitizeHtml, buildSanitizerConfig, type SanitizerConfig } from './sanitizer.js'

/**
 * Markdown parser implementation
 */
export class MarkdownParser implements Parser {
  private options: ParserOptions
  private blockTokenizer: Tokenizer
  private inlineTokenizer: InlineTokenizer
  private renderer: HtmlRenderer
  private tokenTransforms: Array<(tokens: BlockToken[]) => BlockToken[]>
  private htmlTransforms: Array<(html: string) => string>
  private sanitizerConfig: SanitizerConfig | null

  constructor(options: ParserOptions = {}) {
    // Handle ugc shorthand: enables sanitize + safeLinks + disables allowHtml
    const resolved = options?.ugc
      ? { sanitize: true, safeLinks: true, allowHtml: false, ...options, ugc: true }
      : options ?? {}

    this.options = {
      allowHtml: false,
      sanitize: false,
      gfm: false,
      breaks: false,
      ...resolved,
    }

    this.renderer = new HtmlRenderer({
      lazyImages: this.options.lazyImages,
      safeLinks: this.options.safeLinks,
    })

    // Apply user-provided renderer overrides (before plugins, so plugins can override further)
    if (this.options.renderer) {
      for (const [method, fn] of Object.entries(this.options.renderer)) {
        if (typeof fn === 'function') {
          ;(this.renderer as unknown as Record<string, unknown>)[method] = fn.bind(this.renderer)
        }
      }
    }

    // Process plugins
    const builder = new PluginBuilderImpl(this.renderer, this.options)

    if (this.options.plugins) {
      for (const plugin of this.options.plugins) {
        plugin(builder)
      }
    }

    // Apply renderer overrides from plugins (after user overrides, plugins take precedence)
    if (builder.rendererOverrides.size > 0) {
      this.renderer.applyOverrides(builder.rendererOverrides)
    }

    // Store transforms
    this.tokenTransforms = builder.tokenTransforms
    this.htmlTransforms = builder.htmlTransforms

    // Build sanitizer config if sanitization is enabled
    this.sanitizerConfig = (this.options.allowHtml && this.options.sanitize)
      ? buildSanitizerConfig({
          allowedTags: this.options.allowedTags,
          allowedAttributes: this.options.allowedAttributes,
          allowStyle: this.options.allowStyle,
        })
      : null

    // Create tokenizers with custom rules from plugins
    this.blockTokenizer = new Tokenizer(this.options, builder.blockRules)
    this.inlineTokenizer = new InlineTokenizer(builder.inlineRules, {
      breaks: this.options.breaks,
      gfm: this.options.gfm,
    })
  }

  /**
   * Parse markdown to HTML
   *
   * @param markdown - Markdown source string
   * @returns HTML string
   */
  parse(markdown: string): string {
    let tokens = this.tokenize(markdown)

    // Apply token transforms from plugins
    for (const transform of this.tokenTransforms) {
      tokens = transform(tokens)
    }

    let html = this.render(tokens)

    // Sanitize user-provided HTML before plugin transforms.
    // Plugins inject trusted HTML (buttons, scripts, wrappers) that must
    // not be stripped by the sanitizer.
    if (this.sanitizerConfig) {
      html = sanitizeHtml(html, this.sanitizerConfig)
    }

    // Apply HTML transforms from plugins (after sanitization)
    for (const transform of this.htmlTransforms) {
      html = transform(html)
    }

    return html
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
