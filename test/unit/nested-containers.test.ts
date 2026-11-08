import { describe, expect, it } from 'vitest'
import { LineSet } from '../../src/blocks/line-set.js'
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
  })

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
