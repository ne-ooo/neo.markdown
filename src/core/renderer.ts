/**
 * HTML renderer for converting tokens to HTML
 */

import type {
  Renderer,
  HeadingToken,
  ParagraphToken,
  CodeToken,
  HrToken,
  BlockquoteToken,
  ListToken,
  ListItemToken,
  HtmlBlockToken,
  HtmlInlineToken,
  TableToken,
  DirectiveToken,
  TextToken,
  StrongToken,
  EmToken,
  DelToken,
  CodeInlineToken,
  LinkToken,
  ImageToken,
  BrToken,
  InlineToken,
  BlockToken,
} from './types.js'
import { escape, sanitizeUrl } from '../utils/escape.js'

/**
 * Options controlling default renderer behavior
 */
export interface HtmlRendererOptions {
  /** Add loading="lazy" to all images (default: true) */
  lazyImages?: boolean
  /** Safe link handling for user-generated content */
  safeLinks?: {
    externalRel?: string
    externalTarget?: string
    baseUrl?: string
  } | boolean
}

/**
 * Default HTML renderer implementation
 */
export class HtmlRenderer implements Renderer {
  private rendererOptions: HtmlRendererOptions

  constructor(options: HtmlRendererOptions = {}) {
    this.rendererOptions = options
  }
  /**
   * Render heading
   */
  heading(token: HeadingToken): string {
    const text = this.renderInline(token.tokens)
    return `<h${token.level}>${text}</h${token.level}>\n`
  }

  /**
   * Render paragraph
   */
  paragraph(token: ParagraphToken): string {
    const text = this.renderInline(token.tokens)
    return `<p>${text}</p>\n`
  }

  /**
   * Render code block
   */
  code(token: CodeToken): string {
    const code = escape(token.text)
    const lang = token.lang ? ` class="language-${escape(token.lang)}"` : ''
    return `<pre><code${lang}>${code}</code></pre>\n`
  }

  /**
   * Render horizontal rule
   */
  hr(_token: HrToken): string {
    return '<hr>\n'
  }

  /**
   * Render blockquote
   */
  blockquote(token: BlockquoteToken): string {
    const body = this.renderBlock(token.tokens)
    return `<blockquote>\n${body}</blockquote>\n`
  }

  /**
   * Render list
   */
  list(token: ListToken): string {
    const tag = token.ordered ? 'ol' : 'ul'
    const start = token.ordered && token.start !== 1 ? ` start="${token.start}"` : ''
    const body = token.items.map((item) => this.listitem(item)).join('')
    return `<${tag}${start}>\n${body}</${tag}>\n`
  }

  /**
   * Render list item
   * Phase 4: Added support for task list checkboxes (GFM extension)
   */
  listitem(token: ListItemToken): string {
    // Phase 4: Render task list checkbox if present
    const checkbox = token.task
      ? `<input type="checkbox"${token.checked ? ' checked' : ''} disabled> `
      : ''

    // Phase 2: Render nested blocks in list items
    if (token.tokens && token.tokens.length > 0) {
      const content = this.renderBlock(token.tokens)

      // Check if this is a tight list item (no blank lines)
      const isTight = !token.loose

      // For tight lists with single paragraph, unwrap <p> tags
      if (
        isTight &&
        token.tokens.length === 1 &&
        token.tokens[0].type === 'paragraph'
      ) {
        const para = token.tokens[0]
        if (para.type === 'paragraph') {
          const text = this.renderInline(para.tokens)
          return `<li>${checkbox}${text}</li>\n`
        }
      }
      // Loose list item or multiple blocks: keep <p> tags
      return `<li>${checkbox}\n${content}</li>\n`
    }
    // Fallback: render text only
    const text = escape(token.text)
    return `<li>${checkbox}${text}</li>\n`
  }

  /**
   * Render HTML (if allowed)
   */
  html(token: HtmlBlockToken | HtmlInlineToken): string {
    return token.text
  }

  /**
   * Render table
   */
  table(token: TableToken): string {
    const header = this.tablerow(
      token.header.map((cell, i) =>
        this.tablecell(this.renderInline(cell.tokens), token.align[i], true)
      )
    )

    const body = token.rows
      .map((row) =>
        this.tablerow(
          row.map((cell, i) =>
            this.tablecell(this.renderInline(cell.tokens), token.align[i], false)
          )
        )
      )
      .join('')

    return `<table>\n<thead>\n${header}</thead>\n<tbody>\n${body}</tbody>\n</table>\n`
  }

  /**
   * Render table row
   */
  tablerow(cells: string[]): string {
    return `<tr>\n${cells.join('')}</tr>\n`
  }

  /**
   * Render table cell
   */
  tablecell(text: string, align: 'left' | 'center' | 'right' | null, header: boolean): string {
    const tag = header ? 'th' : 'td'
    const alignAttr = align ? ` align="${align}"` : ''
    return `<${tag}${alignAttr}>${text}</${tag}>\n`
  }

  /**
   * Render directive (default: no-op, plugins override this)
   */
  directive(_token: DirectiveToken): string {
    return ''
  }

  /**
   * Apply renderer method overrides from plugins
   */
  applyOverrides(overrides: Map<keyof Renderer, Renderer[keyof Renderer]>): void {
    for (const [method, fn] of overrides) {
      ;(this as Record<string, unknown>)[method] = fn
    }
  }

  /**
   * Render text
   */
  text(token: TextToken): string {
    return escape(token.text)
  }

  /**
   * Render strong (bold)
   */
  strong(token: StrongToken): string {
    const text = this.renderInline(token.tokens)
    return `<strong>${text}</strong>`
  }

  /**
   * Render emphasis (italic)
   */
  em(token: EmToken): string {
    const text = this.renderInline(token.tokens)
    return `<em>${text}</em>`
  }

  /**
   * Render strikethrough (del)
   * Phase 4: GFM extension
   */
  del(token: DelToken): string {
    const text = this.renderInline(token.tokens)
    return `<del>${text}</del>`
  }

  /**
   * Render inline code
   */
  codespan(token: CodeInlineToken): string {
    return `<code>${escape(token.text)}</code>`
  }

  /**
   * Render link
   */
  link(token: LinkToken): string {
    let href = sanitizeUrl(token.href)
    if (!href) {
      // Dangerous URL, render as text
      return this.renderInline(token.tokens)
    }

    const safeLinks = this.rendererOptions.safeLinks
    let extraAttrs = ''

    if (safeLinks) {
      const config = typeof safeLinks === 'object' ? safeLinks : {}
      const isExternal = href.startsWith('http://') || href.startsWith('https://')
      const isAnchor = href.startsWith('#')

      if (isExternal) {
        const rel = config.externalRel ?? 'nofollow noopener noreferrer'
        const target = config.externalTarget ?? '_blank'
        extraAttrs = ` rel="${rel}" target="${target}"`
      } else if (!isAnchor && config.baseUrl) {
        // Resolve relative links against baseUrl
        const base = config.baseUrl.endsWith('/') ? config.baseUrl : config.baseUrl + '/'
        href = base + href.replace(/^\.\//, '')
      }
    }

    const title = token.title ? ` title="${escape(token.title)}"` : ''
    const text = this.renderInline(token.tokens)
    return `<a href="${escape(href)}"${title}${extraAttrs}>${text}</a>`
  }

  /**
   * Render image
   */
  image(token: ImageToken): string {
    let src = sanitizeUrl(token.href)
    if (!src) {
      // Dangerous URL, render as text
      return escape(token.text)
    }

    // Resolve relative image URLs against baseUrl
    const safeLinks = this.rendererOptions.safeLinks
    if (safeLinks && typeof safeLinks === 'object' && safeLinks.baseUrl && src && !src.startsWith('http://') && !src.startsWith('https://') && !src.startsWith('#')) {
      const base = safeLinks.baseUrl.endsWith('/') ? safeLinks.baseUrl : safeLinks.baseUrl + '/'
      src = base + src.replace(/^\.\//, '')
    }

    const title = token.title ? ` title="${escape(token.title)}"` : ''
    const alt = escape(token.text)
    const loading = this.rendererOptions.lazyImages !== false ? ' loading="lazy"' : ''
    return `<img src="${escape(src)}" alt="${alt}"${title}${loading}>`
  }

  /**
   * Render line break
   */
  br(_token: BrToken): string {
    return '<br>\n'
  }

  /**
   * Render block tokens to HTML
   */
  renderBlock(tokens: BlockToken[]): string {
    return tokens.map((token) => this.renderBlockToken(token)).join('')
  }

  /**
   * Render single block token
   */
  private renderBlockToken(token: BlockToken): string {
    switch (token.type) {
      case 'heading':
        return this.heading(token)
      case 'paragraph':
        return this.paragraph(token)
      case 'code':
        return this.code(token)
      case 'hr':
        return this.hr(token)
      case 'blockquote':
        return this.blockquote(token)
      case 'list':
        return this.list(token)
      case 'html':
        return this.html(token)
      case 'table':
        return this.table(token)
      case 'directive':
        return this.directive(token)
      default:
        return ''
    }
  }

  /**
   * Render inline tokens to HTML
   */
  renderInline(tokens: InlineToken[]): string {
    return tokens.map((token) => this.renderInlineToken(token)).join('')
  }

  /**
   * Render single inline token
   */
  private renderInlineToken(token: InlineToken): string {
    switch (token.type) {
      case 'text':
        return this.text(token)
      case 'strong':
        return this.strong(token)
      case 'em':
        return this.em(token)
      case 'del':
        return this.del(token)
      case 'code':
        return this.codespan(token)
      case 'link':
        return this.link(token)
      case 'image':
        return this.image(token)
      case 'br':
        return this.br(token)
      case 'html':
        return this.html(token)
      default:
        return ''
    }
  }
}
