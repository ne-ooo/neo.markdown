import { describe, expect, it } from 'vitest'
import { LineSet } from '../../src/blocks/line-set.js'
import { createIncrementalMarkdown } from '../../src/experimental/incremental.js'
import { createParser } from '../../src/index.js'
import type { BlockRule } from '../../src/core/types.js'

describe('LineSet', () => {
  it('holds offsets as a set, in order', () => {
    const lines = new LineSet([3, 9])
    lines.add(20)
    lines.add(20)
    lines.add(1)
    lines.add(9)

    expect([...lines]).toEqual([1, 3, 9, 20])
    expect(lines.size).toBe(4)
    expect([0, 1, 2, 9, 20, 21].map(offset => lines.has(offset))).toEqual([false, true, false, true, true, false])
    expect(lines.below(9)).toEqual([1, 3])
  })

  it('grows past its first capacity', () => {
    const lines = new LineSet()
    for (let offset = 0; offset < 1_000; offset += 2) lines.add(offset)

    expect(lines.size).toBe(500)
    expect(lines.has(998) && !lines.has(999)).toBe(true)
  })

  // Adding each offset of a descending Set moved every one already held.
  it('sorts offsets given in any order once', () => {
    const descending = new Set(Array.from({ length: 200_000 }, (_, index) => 400_000 - 2 * index))
    const started = performance.now()
    const lines = new LineSet([...descending, 2, 2])

    expect(performance.now() - started).toBeLessThan(500)
    expect(lines.size).toBe(200_000)
    expect([...lines].slice(0, 3)).toEqual([2, 4, 6])
    expect([...new LineSet(lines)]).toEqual([...lines])
    const empty = new LineSet([])
    empty.add(5)
    expect([...empty]).toEqual([5])
  })

  // A Set never matches these against a line's offset.
  it('ignores numbers that are not offsets', () => {
    const lines = new LineSet([1.5, -1, NaN, Infinity, 2 ** 32 + 3, 4])
    lines.add(6.5)
    lines.add(2 ** 31)

    expect([...lines]).toEqual([4])
    expect([1, 3, 6].some(offset => lines.has(offset))).toBe(false)
  })
})

describe('nested containers', () => {
  // Each level tokenized the whole body again and held it, with a Set entry
  // per lazy line, while the levels inside it ran: 256 KB under 99
  // blockquotes took 680 MB and two seconds.
  it('tokenizes a deep container around a long body to a bound, then flat', () => {
    const markdown = `${'> '.repeat(99)}x\n${'y\n'.repeat(131_072)}`
    const html = createParser().parse(markdown)
    const depth = html.match(/<blockquote>/g)!.length

    expect(depth).toBeGreaterThan(8)
    expect(depth).toBeLessThan(99)
    expect(html.match(/y/g)!.length).toBe(131_072)
    // Crossing the bound takes 4,000,000 code units of work, slow under coverage.
  }, 60_000)

  it('still nests a short document as deep as the nesting limit', () => {
    expect(createParser().parse(`${'> '.repeat(99)}x\n${'y\n'.repeat(100)}`).match(/<blockquote>/g)!.length).toBe(99)
  })

  it('accepts a Set of lazy lines from a custom rule', () => {
    const fence: BlockRule = {
      name: 'box',
      priority: 900,
      tokenize(src, _options, context) {
        const match = /^!!!\n([\s\S]*?)\n!!!(?:\n|$)/.exec(src)
        if (!match || !context) return null
        const tokens = context.tokenize(match[1]!, context.depth + 1, new Set([2]))
        return { raw: match[0], token: { type: 'blockquote', raw: match[0], tokens } }
      },
    }

    expect(createParser({ plugins: [builder => builder.addBlockRule(fence)] }).parse('!!!\na\nb\n!!!')).toBe(
      '<blockquote>\n<p>a\nb</p>\n</blockquote>\n',
    )
  })
})

// The nested-work bound is the document's. A block an incremental session
// reuses spends what it spent before, so a changed block gets what a fresh
// parse would leave it: an edit after two such blocks gave 100 levels, where
// a fresh parse gives 67.
describe('nested containers in incremental sessions', () => {
  const block = (marker: string) => `${'> '.repeat(50)}${marker}\n${'y'.repeat(60_000)}\n\n`
  // List items are tokenized, and reused, as children of their list.
  const items = (...markers: string[]) =>
    markers.map(marker => `- ${'> '.repeat(40)}${marker}\n  ${'y'.repeat(50_000)}\n`).join('')
  const session = () => createIncrementalMarkdown({
    maxInputLength: 1_000_000,
    maxWorkCodeUnits: 10_000_000_000,
    maxCachedBlockCodeUnits: 1_000_000_000,
    maxCachedBlockTokens: 1_000_000,
  })

  it.each([
    ['a block after reused ones', block('x') + block('x'), block('x') + block('z')],
    // The suffix was parsed after a paragraph, with the whole bound left.
    ['a block before a reused suffix', `para\n\n${block('x')}`, block('z') + block('x')],
    ['a document that grows past the bound', `${block('x')}tail\n`, `${block('x') + block('x')}tail\n`],
    ['an item appended after reused siblings', items('x', 'x'), items('x', 'x', 'x')],
  ])('renders %s as a fresh parse does', (_, before, after) => {
    const incremental = session()
    incremental.update(before)

    expect(incremental.update(after).html).toBe(createParser().parse(after))
  }, 60_000)

  // A fresh parse sizes the bound from the document before its line endings
  // are normalized, which here leaves room for two more levels.
  it('sizes the bound as a fresh parse does', () => {
    const markdown = `${'> '.repeat(50)}x\r\n${'y\r\n'.repeat(200_000)}`

    expect(session().update(markdown).html).toBe(createParser().parse(markdown))
  }, 60_000)
})
