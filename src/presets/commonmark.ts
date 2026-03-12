/**
 * CommonMark preset - Basic markdown features only
 *
 * Includes: headings, paragraphs, lists, blockquotes, code blocks, emphasis, links, images
 * Bundle size: ~15-20 KB
 *
 * @example
 * ```typescript
 * import { parse } from '@lpm.dev/neo.markdown/commonmark'
 *
 * parse('# Hello\n\n**Bold** and *italic*')
 * ```
 */

import type { ParserOptions } from '../core/types.js'
import { createParser } from '../core/parser.js'

/**
 * Parse markdown using CommonMark preset
 *
 * @param markdown - Markdown source string
 * @param options - Additional parser options
 * @returns HTML string
 */
export function parse(markdown: string, options?: Partial<ParserOptions>): string {
  const parser = createParser({
    allowHtml: false,
    sanitize: false,
    gfm: false,
    breaks: false,
    ...options,
  })
  return parser.parse(markdown)
}

// Re-export types
export type * from '../core/types.js'
export { createParser } from '../core/parser.js'
