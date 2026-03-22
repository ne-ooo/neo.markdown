/**
 * Core types for the markdown parser
 */

/**
 * Token types for block-level elements
 */
export type BlockTokenType =
  | 'heading'
  | 'paragraph'
  | 'list'
  | 'blockquote'
  | 'code'
  | 'hr'
  | 'html'
  | 'table'
  | 'directive'

/**
 * Token types for inline elements
 */
export type InlineTokenType =
  | 'text'
  | 'strong'
  | 'em'
  | 'del'
  | 'code'
  | 'link'
  | 'image'
  | 'br'
  | 'html'

/**
 * Base token interface
 */
export interface Token {
  type: BlockTokenType | InlineTokenType
  raw: string
}

/**
 * Heading token
 */
export interface HeadingToken extends Token {
  type: 'heading'
  level: 1 | 2 | 3 | 4 | 5 | 6
  text: string
  tokens: InlineToken[]
}

/**
 * Paragraph token
 */
export interface ParagraphToken extends Token {
  type: 'paragraph'
  text: string
  tokens: InlineToken[]
}

/**
 * Code block token
 */
export interface CodeToken extends Token {
  type: 'code'
  lang?: string
  meta?: string
  text: string
}

/**
 * Directive token (for plugins like embeds)
 * Follows the CommonMark Generic Directives proposal
 */
export interface DirectiveToken extends Token {
  type: 'directive'
  name: string
  label?: string
  attributes: Record<string, string>
}

/**
 * Horizontal rule token
 */
export interface HrToken extends Token {
  type: 'hr'
}

/**
 * Blockquote token
 */
export interface BlockquoteToken extends Token {
  type: 'blockquote'
  tokens: BlockToken[]
}

/**
 * List token
 */
export interface ListToken extends Token {
  type: 'list'
  ordered: boolean
  start?: number
  items: ListItemToken[]
}

/**
 * List item token
 */
export interface ListItemToken {
  text: string
  tokens: BlockToken[]
  task?: boolean
  checked?: boolean
  loose?: boolean // Phase 2: loose vs tight lists
}

/**
 * HTML block token
 */
export interface HtmlBlockToken extends Token {
  type: 'html'
  text: string
}

/**
 * Table token
 */
export interface TableToken extends Token {
  type: 'table'
  header: TableCell[]
  align: Array<'left' | 'center' | 'right' | null>
  rows: TableCell[][]
}

/**
 * Table cell
 */
export interface TableCell {
  text: string
  tokens: InlineToken[]
}

/**
 * Text token
 */
export interface TextToken extends Token {
  type: 'text'
  text: string
}

/**
 * Strong (bold) token
 */
export interface StrongToken extends Token {
  type: 'strong'
  text: string
  tokens: InlineToken[]
}

/**
 * Emphasis (italic) token
 */
export interface EmToken extends Token {
  type: 'em'
  text: string
  tokens: InlineToken[]
}

/**
 * Strikethrough token (GFM)
 * Phase 4: GitHub Flavored Markdown extension
 */
export interface DelToken extends Token {
  type: 'del'
  text: string
  tokens: InlineToken[]
}

/**
 * Inline code token
 */
export interface CodeInlineToken extends Token {
  type: 'code'
  text: string
}

/**
 * Link token
 */
export interface LinkToken extends Token {
  type: 'link'
  href: string
  title?: string
  text: string
  tokens: InlineToken[]
}

/**
 * Image token
 */
export interface ImageToken extends Token {
  type: 'image'
  href: string
  title?: string
  text: string
}

/**
 * Line break token
 */
export interface BrToken extends Token {
  type: 'br'
}

/**
 * Inline HTML token
 */
export interface HtmlInlineToken extends Token {
  type: 'html'
  text: string
}

/**
 * Union of all block tokens
 */
export type BlockToken =
  | HeadingToken
  | ParagraphToken
  | CodeToken
  | HrToken
  | BlockquoteToken
  | ListToken
  | HtmlBlockToken
  | TableToken
  | DirectiveToken

/**
 * Union of all inline tokens
 */
export type InlineToken =
  | TextToken
  | StrongToken
  | EmToken
  | DelToken
  | CodeInlineToken
  | LinkToken
  | ImageToken
  | BrToken
  | HtmlInlineToken

/**
 * Parser options
 */
export interface ParserOptions {
  /**
   * Allow raw HTML in markdown (default: false for security)
   */
  allowHtml?: boolean

  /**
   * Sanitize HTML tags and attributes (default: false)
   */
  sanitize?: boolean

  /**
   * Additional HTML tags to allow when sanitize is true (extends defaults)
   */
  allowedTags?: string[]

  /**
   * Additional HTML attributes to allow per tag when sanitize is true (extends defaults)
   * Keys are tag names, values are arrays of attribute names.
   * @example { iframe: ['src', 'width', 'height'] }
   */
  allowedAttributes?: Record<string, string[]>

  /**
   * Allow inline style attributes when sanitize is true (default: false)
   */
  allowStyle?: boolean

  /**
   * Enable GitHub Flavored Markdown (GFM) features
   */
  gfm?: boolean

  /**
   * Enable line breaks as <br> (GFM behavior)
   */
  breaks?: boolean

  /**
   * Add loading="lazy" to all rendered images (default: true)
   */
  lazyImages?: boolean

  /**
   * Safe link handling for user-generated content.
   * When true, uses defaults: rel="nofollow noopener noreferrer" target="_blank" for external links.
   * When object, allows customization of rel, target, and baseUrl for relative link resolution.
   */
  safeLinks?: {
    externalRel?: string
    externalTarget?: string
    baseUrl?: string
  } | boolean

  /**
   * Shorthand: enables sanitize + safeLinks + sets allowHtml to false.
   * Designed for rendering untrusted user-generated content safely.
   */
  ugc?: boolean

  /**
   * Custom set of block rules for tree-shaking.
   * When provided, only these rules are used (instead of all built-in rules).
   * Import individual rules from '@lpm.dev/neo.markdown/blocks'.
   *
   * @example
   * ```typescript
   * import { heading, paragraph, code, list } from '@lpm.dev/neo.markdown/blocks'
   * const parser = createParser({ blocks: [heading, paragraph, code, list] })
   * ```
   */
  blocks?: BlockRule[]

  /**
   * Custom renderer for overriding default HTML output
   */
  renderer?: Partial<Renderer>

  /**
   * Plugins to extend the parser
   */
  plugins?: MarkdownPlugin[]
}

/**
 * Renderer interface for converting tokens to HTML
 */
export interface Renderer {
  // Block renderers
  heading(token: HeadingToken): string
  paragraph(token: ParagraphToken): string
  code(token: CodeToken): string
  hr(token: HrToken): string
  blockquote(token: BlockquoteToken): string
  list(token: ListToken): string
  listitem(token: ListItemToken): string
  html(token: HtmlBlockToken | HtmlInlineToken): string
  table(token: TableToken): string
  tablerow(cells: string[]): string
  tablecell(text: string, align: 'left' | 'center' | 'right' | null, header: boolean): string
  directive(token: DirectiveToken): string

  // Inline renderers
  text(token: TextToken): string
  strong(token: StrongToken): string
  em(token: EmToken): string
  del(token: DelToken): string
  codespan(token: CodeInlineToken): string
  link(token: LinkToken): string
  image(token: ImageToken): string
  br(token: BrToken): string
}

/**
 * Parser interface
 */
export interface Parser {
  /**
   * Parse markdown to HTML
   */
  parse(markdown: string): string

  /**
   * Parse markdown to tokens
   */
  tokenize(markdown: string): BlockToken[]

  /**
   * Render tokens to HTML
   */
  render(tokens: BlockToken[]): string
}

// ---------------------------------------------------------------------------
// Plugin System Types
// ---------------------------------------------------------------------------

/**
 * A plugin is a plain function that receives a builder to configure extensions
 */
export type MarkdownPlugin = (builder: PluginBuilder) => void

/**
 * Builder interface provided to plugins for registering extensions
 */
export interface PluginBuilder {
  /** Register a custom block-level tokenization rule */
  addBlockRule(rule: BlockRule): void
  /** Register a custom inline tokenization rule */
  addInlineRule(rule: InlineRule): void
  /** Override a renderer method */
  setRenderer<K extends keyof Renderer>(method: K, fn: Renderer[K]): void
  /** Add a token-level transform (runs after tokenization, before rendering) */
  addTokenTransform(fn: (tokens: BlockToken[]) => BlockToken[]): void
  /** Add an HTML-level transform (runs after rendering) */
  addHtmlTransform(fn: (html: string) => string): void
  /** Render inline tokens to HTML (utility for plugin authors) */
  renderInline(tokens: InlineToken[]): string
  /** Render block tokens to HTML (utility for plugin authors) */
  renderBlock(tokens: BlockToken[]): string
  /** Read-only access to parser options */
  readonly options: Readonly<ParserOptions>
}

/**
 * Custom block-level tokenization rule
 */
export interface BlockRule {
  /** Unique name for this rule */
  name: string
  /** Numeric priority (higher = tried first) or positional constraint */
  priority?: number | `before:${string}` | `after:${string}`
  /** Tokenize function — returns token + consumed raw string, or null */
  tokenize(src: string, options: ParserOptions): { token: BlockToken; raw: string } | null
}

/**
 * Custom inline tokenization rule
 */
export interface InlineRule {
  /** Unique name for this rule */
  name: string
  /** Numeric priority (higher = tried first) or positional constraint */
  priority?: number | `before:${string}` | `after:${string}`
  /** Character codes that trigger this rule (preserves fast-path optimization) */
  triggerChars?: number[]
  /** Tokenize function — returns token + consumed raw string, or null */
  tokenize(src: string): { token: InlineToken; raw: string } | null
}
