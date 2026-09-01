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
import { MarkdownParserBase } from '../core/parser.js'
import { code } from '../blocks/rules/code.js'
import { definition } from '../blocks/rules/definition.js'
import { indentedCode } from '../blocks/rules/indented-code.js'
import { heading } from '../blocks/rules/heading.js'
import { setextHeading } from '../blocks/rules/setext-heading.js'
import { hr } from '../blocks/rules/hr.js'
import { blockquote } from '../blocks/rules/blockquote.js'
import { list } from '../blocks/rules/list.js'
import { html } from '../blocks/rules/html.js'
import { paragraph } from '../blocks/rules/paragraph.js'

let defaultParser: Parser | undefined

const commonMarkBlockRules = [
  code,
  definition,
  setextHeading,
  heading,
  hr,
  blockquote,
  list,
  html,
  indentedCode,
  paragraph,
]

export function createParser(options: Partial<ParserOptions> = {}): Parser {
  const resolved = {
    allowHtml: false,
    sanitize: false,
    breaks: false,
    ...options,
    gfm: false,
  }
  return new MarkdownParserBase(resolved, options.blocks ?? commonMarkBlockRules)
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
    defaultParser ??= createParser()
    return defaultParser.parse(markdown)
  }

  return createParser(options).parse(markdown)
}

// Re-export types
export type * from '../core/types.js'
