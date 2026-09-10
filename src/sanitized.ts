/** Default parser entry with the built-in structural HTML sanitizer. */

import type { Parser, ParserOptions, DocumentOptions, DocumentResult } from './core/types.js'
import { MarkdownParser } from './core/parser.js'
import { allBlockRules } from './blocks/rules.js'
import { sanitizeHtml } from './sanitizers/structural.js'

let defaultParser: Parser | undefined

export type * from './core/types.js'
export { HtmlRenderer } from './core/renderer.js'
export { DEFAULT_ALLOWED_TAGS, DEFAULT_ALLOWED_ATTRIBUTES } from './core/sanitizer.js'
export { sanitizeHtml } from './sanitizers/structural.js'
export { escape as escapeHtml } from './utils/escape.js'

/** Create a parser with the built-in structural HTML sanitizer. */
export function createParser(options: ParserOptions = {}): Parser {
  return new MarkdownParser(
    { sanitizer: sanitizeHtml, ...options },
    options.blocks ?? allBlockRules
  )
}

/** Parse markdown with the built-in structural HTML sanitizer. */
export function parse(markdown: string, options?: ParserOptions): string {
  if (options === undefined) {
    defaultParser ??= createParser()
    return defaultParser.parse(markdown)
  }

  return createParser(options).parse(markdown)
}

/** Parse a structured document with the same sanitizer configuration as parse(). */
export function parseDocument(markdown: string, options?: ParserOptions, documentOptions?: DocumentOptions): DocumentResult {
  if (options === undefined) {
    defaultParser ??= createParser()
    return defaultParser.parseDocument(markdown, documentOptions)
  }
  return createParser(options).parseDocument(markdown, documentOptions)
}
