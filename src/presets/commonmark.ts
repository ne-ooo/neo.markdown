/**
 * Core Markdown-subset preset - GFM extensions disabled
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

import type { Parser, ParserOptions } from '../core/types.js'
import { createParser } from '../create-parser.js'

let defaultParser: Parser | undefined

function createCommonMarkParser(options?: Partial<ParserOptions>): Parser {
  return createParser({
    allowHtml: false,
    sanitize: false,
    gfm: false,
    breaks: false,
    ...options,
  })
}

/**
 * Parse markdown using the core Markdown-subset preset
 *
 * @param markdown - Markdown source string
 * @param options - Additional parser options
 * @returns HTML string
 */
export function parse(markdown: string, options?: Partial<ParserOptions>): string {
  if (options === undefined) {
    defaultParser ??= createCommonMarkParser()
    return defaultParser.parse(markdown)
  }

  return createCommonMarkParser(options).parse(markdown)
}

// Re-export types
export type * from '../core/types.js'
export { createParser } from '../create-parser.js'
