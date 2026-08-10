/**
 * Main markdown parser
 */

import type {
  Parser,
  ParserOptions,
  BlockRule,
  BlockToken,
  InlineToken,
  ParagraphToken,
  HeadingToken,
  LinkReference,
  TableToken,
  HtmlSanitizer,
  SanitizerConfig,
} from './types.js'
import { Tokenizer } from './tokenizer.js'
import { InlineTokenizer } from './inline-tokenizer.js'
import { HtmlRenderer } from './renderer.js'
import { PluginBuilderImpl } from './plugin-builder.js'
import { buildSanitizerConfig } from './sanitizer.js'

const MAX_UGC_INPUT_LENGTH = 1_000_000
const RAW_HTML_ERROR = 'Raw HTML tokens require allowHtml: true'

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
  private sanitizer: HtmlSanitizer | null

  constructor(options: ParserOptions = {}, blockRules: BlockRule[] = options.blocks ?? []) {
    // UGC mode is a security boundary, not a set of overridable defaults.
    const supplied = options ?? {}
    if (
      supplied.maxInputLength !== undefined
      && (!Number.isSafeInteger(supplied.maxInputLength) || supplied.maxInputLength < 0)
    ) {
      throw new TypeError('maxInputLength must be a non-negative safe integer')
    }

    const resolved = supplied.ugc
      ? {
          ...supplied,
          allowHtml: false,
          sanitize: true,
          safeLinks: true,
          ugc: true,
          maxInputLength: Math.min(
            supplied.maxInputLength ?? MAX_UGC_INPUT_LENGTH,
            MAX_UGC_INPUT_LENGTH
          ),
        }
      : supplied

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

    if (
      this.options.allowHtml
      && this.options.sanitize
      && typeof this.options.sanitizer !== 'function'
    ) {
      throw new TypeError(
        'HTML sanitization requires a sanitizer provider; import from "@lpm.dev/neo.markdown/sanitized"'
      )
    }

    this.sanitizer = this.options.allowHtml && this.options.sanitize
      ? this.options.sanitizer ?? null
      : null

    // Build sanitizer config if sanitization is enabled.
    this.sanitizerConfig = (this.options.allowHtml && this.options.sanitize)
      ? buildSanitizerConfig({
          allowedTags: this.options.allowedTags,
          allowedAttributes: this.options.allowedAttributes,
          allowStyle: this.options.allowStyle,
        })
      : null

    // Create tokenizers with custom rules from plugins
    this.blockTokenizer = new Tokenizer(this.options, blockRules, builder.blockRules)
    this.inlineTokenizer = new InlineTokenizer(builder.inlineRules, {
      breaks: this.options.breaks,
      gfm: this.options.gfm,
      allowHtml: this.options.allowHtml,
    })
  }

  /**
   * Parse markdown to HTML
   *
   * @param markdown - Markdown source string
   * @returns HTML string
   */
  parse(markdown: string): string {
    return this.render(this.tokenize(markdown))
  }

  /**
   * Render tokens through the same transforms and security pipeline as parse().
   *
   * @param tokens - Array of block tokens
   * @returns HTML string
   */
  render(tokens: BlockToken[]): string {
    let transformedTokens = tokens

    // Apply token transforms from plugins
    for (const transform of this.tokenTransforms) {
      transformedTokens = transform(transformedTokens)
    }

    if (!this.options.allowHtml) {
      this.assertNoRawHtmlBlocks(transformedTokens)
    }

    let html = this.renderer.renderBlock(transformedTokens)

    // Sanitize user-provided HTML before plugin transforms.
    // Plugins inject trusted HTML (buttons, scripts, wrappers) that must
    // not be stripped by the sanitizer.
    if (this.sanitizer && this.sanitizerConfig) {
      html = this.sanitizer(html, this.sanitizerConfig)
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
    if (
      this.options.maxInputLength !== undefined
      && markdown.length > this.options.maxInputLength
    ) {
      throw new RangeError(
        `Markdown input length ${markdown.length} exceeds maxInputLength ${this.options.maxInputLength}`
      )
    }

    const blockTokens = this.blockTokenizer.tokenize(markdown)
    const references = new Map<string, LinkReference>()
    this.collectReferenceDefinitions(blockTokens, references)

    // Parse inline content recursively
    return this.processInlineTokens(blockTokens, references)
  }

  private collectReferenceDefinitions(
    tokens: BlockToken[],
    references: Map<string, LinkReference>
  ): void {
    for (const token of tokens) {
      if (token.type === 'definition') {
        if (token.label.length > 999) continue
        const label = InlineTokenizer.normalizeReferenceLabel(token.label)
        if (!references.has(label)) {
          references.set(label, { href: token.href, title: token.title })
        }
      } else if (token.type === 'blockquote') {
        this.collectReferenceDefinitions(token.tokens, references)
      } else if (token.type === 'list') {
        for (const item of token.items) this.collectReferenceDefinitions(item.tokens, references)
      }
    }
  }

  /**
   * Recursively process inline tokens for all block tokens
   *
   * @param tokens - Array of block tokens
   * @returns Array of block tokens with inline tokens processed
   */
  private processInlineTokens(
    tokens: BlockToken[],
    references: ReadonlyMap<string, LinkReference>
  ): BlockToken[] {
    return tokens.map((token) => {
      if (token.type === 'paragraph') {
        return {
          ...token,
          tokens: this.inlineTokenizer.tokenize(token.text, references),
        } as ParagraphToken
      }

      if (token.type === 'heading') {
        return {
          ...token,
          tokens: this.inlineTokenizer.tokenize(token.text, references),
        } as HeadingToken
      }

      if (token.type === 'blockquote') {
        return {
          ...token,
          tokens: this.processInlineTokens(token.tokens, references),
        }
      }

      if (token.type === 'list') {
        return {
          ...token,
          items: token.items.map((item) => ({
            ...item,
            tokens: this.processInlineTokens(item.tokens, references),
          })),
        }
      }

      if (token.type === 'table') {
        return {
          ...token,
          header: token.header.map((cell) => ({
            ...cell,
            tokens: this.inlineTokenizer.tokenize(cell.text, references),
          })),
          rows: token.rows.map((row) =>
            row.map((cell) => ({
              ...cell,
              tokens: this.inlineTokenizer.tokenize(cell.text, references),
            }))
          ),
        } as TableToken
      }

      return token
    })
  }

  private assertNoRawHtmlBlocks(tokens: BlockToken[]): void {
    for (const token of tokens) {
      if (token.type === 'html') throw new TypeError(RAW_HTML_ERROR)

      if (token.type === 'paragraph' || token.type === 'heading') {
        this.assertNoRawHtmlInline(token.tokens)
      } else if (token.type === 'blockquote') {
        this.assertNoRawHtmlBlocks(token.tokens)
      } else if (token.type === 'list') {
        for (const item of token.items) this.assertNoRawHtmlBlocks(item.tokens)
      } else if (token.type === 'table') {
        for (const cell of token.header) this.assertNoRawHtmlInline(cell.tokens)
        for (const row of token.rows) {
          for (const cell of row) this.assertNoRawHtmlInline(cell.tokens)
        }
      }
    }
  }

  private assertNoRawHtmlInline(tokens: InlineToken[]): void {
    for (const token of tokens) {
      if (token.type === 'html') throw new TypeError(RAW_HTML_ERROR)
      if (
        token.type === 'strong'
        || token.type === 'em'
        || token.type === 'del'
        || token.type === 'link'
      ) {
        this.assertNoRawHtmlInline(token.tokens)
      }
    }
  }

}

/**
 * Create a new parser instance
 *
 * @param options - Parser options
 * @returns Parser instance
 */
export function createParser(options: ParserOptions & { blocks: BlockRule[] }): Parser {
  return new MarkdownParser(options, options.blocks)
}
