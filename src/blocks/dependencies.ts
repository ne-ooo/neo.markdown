import type { BlockRuleContext } from '../core/types.js'

/** Record a complete inspected line, including the EOF decision. Offsets are local to the rule input. */
export function dependOnLine(source: string, start: number, context?: BlockRuleContext): void {
  if (!context?.dependOn) return
  const end = source.indexOf('\n', start)
  context.dependOn(end < 0 ? source.length + 1 : end + 1)
}
