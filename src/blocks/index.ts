/**
 * Block-level element exports (tree-shakeable)
 *
 * Import only the block types you need for optimal bundle size
 *
 * @example
 * ```typescript
 * import { heading, paragraph } from '@lpm.dev/neo.markdown/blocks'
 * ```
 */

// Re-export relevant types
export type {
  BlockToken,
  HeadingToken,
  ParagraphToken,
  CodeToken,
  HrToken,
  BlockquoteToken,
  ListToken,
  ListItemToken,
  HtmlBlockToken,
  TableToken,
} from '../core/types.js'

// Note: Individual block implementations will be added in Phase 2
// For now, use the full parser from core
export { Tokenizer } from '../core/tokenizer.js'
