/**
 * Block-level element exports (tree-shakeable)
 *
 * Import only the block rules you need for optimal bundle size.
 *
 * @example
 * ```typescript
 * import { heading, paragraph, code, list } from '@lpm.dev/neo.markdown/blocks'
 *
 * const parser = createParser({ blocks: [heading, paragraph, code, list] })
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

// Individual block rules (tree-shakeable)
export {
  code,
  indentedCode,
  heading,
  setextHeading,
  hr,
  table,
  blockquote,
  list,
  html,
  paragraph,
  allBlockRules,
} from './rules.js'

// Full tokenizer (for advanced usage)
export { Tokenizer } from '../core/tokenizer.js'
