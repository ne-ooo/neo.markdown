/** Built-in block rules. Each implementation is isolated for tree-shaking. */

import { code } from './rules/code.js'
import { definition } from './rules/definition.js'
import { indentedCode } from './rules/indented-code.js'
import { heading } from './rules/heading.js'
import { setextHeading } from './rules/setext-heading.js'
import { hr } from './rules/hr.js'
import { table } from './rules/table.js'
import { blockquote } from './rules/blockquote.js'
import { list } from './rules/list.js'
import { html } from './rules/html.js'
import { paragraph } from './rules/paragraph.js'

export { code } from './rules/code.js'
export { definition } from './rules/definition.js'
export { indentedCode } from './rules/indented-code.js'
export { heading } from './rules/heading.js'
export { setextHeading } from './rules/setext-heading.js'
export { hr } from './rules/hr.js'
export { table } from './rules/table.js'
export { blockquote } from './rules/blockquote.js'
export { list } from './rules/list.js'
export { html } from './rules/html.js'
export { paragraph } from './rules/paragraph.js'

/** Complete default rule set in precedence order. */
export const allBlockRules = [
  code,
  definition,
  setextHeading,
  heading,
  hr,
  table,
  blockquote,
  list,
  html,
  indentedCode,
  paragraph,
]
