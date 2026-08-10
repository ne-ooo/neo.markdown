/**
 * Table of Contents plugin for neo.markdown
 *
 * Adds slugified IDs and anchor links to headings.
 * Optionally extracts a table of contents data structure.
 *
 * @example
 * ```typescript
 * import { tocPlugin } from '@lpm.dev/neo.markdown/plugins/toc'
 *
 * const html = parse(markdown, {
 *   plugins: [tocPlugin({ maxDepth: 3 })]
 * })
 * ```
 */

import type { MarkdownPlugin, HeadingToken, InlineToken } from '../core/types.js'
import { createSlugger } from '../utils/slug.js'
import { escape } from '../utils/escape.js'

/**
 * TOC entry representing a heading
 */
export interface TocEntry {
  /** Heading level (1-6) */
  level: number
  /** Raw text content */
  text: string
  /** Slugified ID */
  id: string
}

/**
 * TOC plugin options
 */
export interface TocOptions {
  /** Maximum heading depth to include (default: 6) */
  maxDepth?: 1 | 2 | 3 | 4 | 5 | 6
  /** Minimum heading depth to include (default: 1) */
  minDepth?: 1 | 2 | 3 | 4 | 5 | 6
  /** Add anchor links to headings (default: true) */
  anchorLinks?: boolean
  /** CSS class for the anchor link (default: "anchor") */
  anchorClass?: string
  /** Callback to receive the extracted TOC entries */
  onToc?: (entries: TocEntry[]) => void
}

function extractInlineText(tokens: InlineToken[]): string {
  const parts: string[] = []
  for (const token of tokens) {
    if (token.type === 'text' || token.type === 'code') {
      parts.push(token.text)
    } else if (
      token.type === 'strong'
      || token.type === 'em'
      || token.type === 'del'
      || token.type === 'link'
    ) {
      parts.push(extractInlineText(token.tokens))
    }
  }
  return parts.join('')
}

/**
 * Create the TOC plugin
 *
 * @param options - TOC options
 * @returns Markdown plugin
 */
export function tocPlugin(options: TocOptions = {}): MarkdownPlugin {
  const {
    maxDepth = 6,
    minDepth = 1,
    anchorLinks = true,
    anchorClass = 'anchor',
    onToc,
  } = options

  return (builder) => {
    // 1. Token transform: collect headings and assign slug IDs
    builder.addTokenTransform((tokens) => {
      const slugger = createSlugger()
      const tocEntries: TocEntry[] = []

      const transformed = tokens.map((token) => {
        if (token.type !== 'heading') return token
        if (token.level < minDepth || token.level > maxDepth) return token

        // Walk tokens directly so malformed raw HTML cannot trigger repeated
        // whole-suffix scans before the sanitizer runs.
        const plainText = extractInlineText(token.tokens)
        const id = slugger.slug(plainText)

        tocEntries.push({ level: token.level, text: plainText, id })
        return { ...token, tocId: id }
      })

      // Deliver TOC entries via callback
      if (onToc && tocEntries.length > 0) {
        onToc([...tocEntries])
      }

      return transformed
    })

    // 2. Override heading renderer to add IDs and anchor links
    builder.setRenderer('heading', (token: HeadingToken) => {
      const text = builder.renderInline(token.tokens)

      // If heading outside min/max range, render normally
      if (token.level < minDepth || token.level > maxDepth) {
        return `<h${token.level}>${text}</h${token.level}>\n`
      }

      const id = (token as HeadingToken & { tocId?: string }).tocId

      if (!id) {
        return `<h${token.level}>${text}</h${token.level}>\n`
      }

      if (anchorLinks) {
        return (
          `<h${token.level} id="${escape(id)}">` +
          `<a class="${escape(anchorClass)}" href="#${escape(id)}">${text}</a>` +
          `</h${token.level}>\n`
        )
      }

      return `<h${token.level} id="${escape(id)}">${text}</h${token.level}>\n`
    })
  }
}
