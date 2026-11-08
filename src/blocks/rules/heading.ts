import type { BlockRule } from '../../core/types.js'

const HEADING = /^ {0,3}(#{1,6})(?=[ \t\n]|$)(.*)(?:\n+|$)/

/** ATX heading rule (`# Heading`). */
export const heading: BlockRule = {
  name: 'heading',
  priority: 800,
  starts: (src) => HEADING.test(src),
  tokenize(src) {
    const match = HEADING.exec(src)
    if (!match) return null
    const raw = match[0]
    const level = match[1].length as 1 | 2 | 3 | 4 | 5 | 6
    const text = headingText(match[2])
    return { token: { type: 'heading', raw, level, text, tokens: [] }, raw }
  },
}

const isSpaceOrTab = (char: string | undefined): boolean => char === ' ' || char === '\t'

/**
 * The heading's text without its optional closing sequence (`##` preceded by
 * spaces or tabs, or the whole text) and without outer spaces and tabs.
 * Scanned from the end: trailing-run patterns retried the run at every offset,
 * so a long run of spaces before a final character took quadratic time.
 */
function headingText(value: string): string {
  let end = value.length
  while (end > 0 && isSpaceOrTab(value[end - 1])) end--
  let hashes = end
  while (hashes > 0 && value[hashes - 1] === '#') hashes--
  if (hashes < end) {
    let gap = hashes
    while (gap > 0 && isSpaceOrTab(value[gap - 1])) gap--
    if (gap === 0 || gap < hashes) value = value.slice(0, gap)
  }
  let start = 0
  let finish = value.length
  while (start < finish && isSpaceOrTab(value[start])) start++
  while (finish > start && isSpaceOrTab(value[finish - 1])) finish--
  return value.slice(start, finish)
}
