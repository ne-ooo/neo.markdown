/**
 * GitHub Flavored Markdown (GFM) preset
 *
 * Includes: All CommonMark features + tables, task lists, strikethrough, autolinks
 * Bundle size: ~25-30 KB
 *
 * @example
 * ```typescript
 * import { parse } from '@lpm.dev/neo.markdown/gfm'
 *
 * parse(`
 * | Feature | Supported |
 * |---------|-----------|
 * | Tables  | ✅        |
 *
 * - [x] Task 1
 * - [ ] Task 2
 * `)
 * ```
 */

import type { ParserOptions } from '../core/types.js'
import { createParser } from '../core/parser.js'

/**
 * Parse markdown using GFM preset
 *
 * @param markdown - Markdown source string
 * @param options - Additional parser options
 * @returns HTML string
 */
export function parse(markdown: string, options?: Partial<ParserOptions>): string {
  const parser = createParser({
    allowHtml: false,
    sanitize: false,
    gfm: true,
    breaks: true,
    ...options,
  })
  return parser.parse(markdown)
}

// Re-export types
export type * from '../core/types.js'
export { createParser } from '../core/parser.js'
