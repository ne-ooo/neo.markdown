/**
 * @lpm.dev/neo.markdown - Modern, tree-shakeable markdown parser
 *
 * @example
 * ```typescript
 * import { parse } from '@lpm.dev/neo.markdown'
 *
 * const html = parse('# Hello\n\nWorld')
 * // => '<h1>Hello</h1>\n<p>World</p>\n'
 * ```
 */

import type { Parser, ParserOptions } from './core/types.js'
import { createParser } from './create-parser.js'

let defaultParser: Parser | undefined

// Re-export core types and utilities
export type * from './core/types.js'
export { createParser } from './create-parser.js'
export { HtmlRenderer } from './core/renderer.js'
export { DEFAULT_ALLOWED_TAGS, DEFAULT_ALLOWED_ATTRIBUTES } from './core/sanitizer.js'
export { escape as escapeHtml } from './utils/escape.js'

/**
 * Parse markdown to HTML
 *
 * @param markdown - Markdown source string
 * @param options - Parser options
 * @returns HTML string
 *
 * @example
 * ```typescript
 * // Basic usage
 * parse('# Hello World')
 * // => '<h1>Hello World</h1>\n'
 *
 * // With options
 * parse('# Hello\n\n<script>alert("xss")</script>', {
 *   allowHtml: false // Default - XSS protection
 * })
 * // => '<h1>Hello</h1>\n<p>&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;</p>\n'
 * ```
 */
export function parse(markdown: string, options?: ParserOptions): string {
  if (options === undefined) {
    defaultParser ??= createParser()
    return defaultParser.parse(markdown)
  }

  const parser = createParser(options)
  return parser.parse(markdown)
}
