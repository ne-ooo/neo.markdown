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
  text: string
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
   * Allowed HTML tags when sanitize is true
   */
  allowedTags?: string[]

  /**
   * Allowed HTML attributes when sanitize is true
   */
  allowedAttributes?: string[]

  /**
   * Enable GitHub Flavored Markdown (GFM) features
   */
  gfm?: boolean

  /**
   * Enable line breaks as <br> (GFM behavior)
   */
  breaks?: boolean

  /**
   * Custom renderer for overriding default HTML output
   */
  renderer?: Partial<Renderer>
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
