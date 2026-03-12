/**
 * Inline element exports (tree-shakeable)
 *
 * Import only the inline types you need for optimal bundle size
 *
 * @example
 * ```typescript
 * import { emphasis, link } from '@lpm.dev/neo.markdown/inline'
 * ```
 */

// Re-export relevant types
export type {
  InlineToken,
  TextToken,
  StrongToken,
  EmToken,
  CodeInlineToken,
  LinkToken,
  ImageToken,
  BrToken,
  HtmlInlineToken,
} from '../core/types.js'

// Note: Individual inline implementations will be added in Phase 3
// For now, use the full parser from core
export { InlineTokenizer } from '../core/inline-tokenizer.js'
