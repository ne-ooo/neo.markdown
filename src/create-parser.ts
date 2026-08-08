/** Default parser factory containing the complete built-in block rule set. */

import type { Parser, ParserOptions } from './core/types.js'
import { MarkdownParser } from './core/parser.js'
import { allBlockRules } from './blocks/rules.js'

/** Create a parser with all built-ins, or a caller-supplied selective rule set. */
export function createParser(options: ParserOptions = {}): Parser {
  return new MarkdownParser(options, options.blocks ?? allBlockRules)
}
