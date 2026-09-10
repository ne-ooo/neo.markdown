import { describe, expect, it } from 'vitest'
import { createIncrementalMarkdown } from '../../src/experimental/incremental.js'
import { createParser } from '../../src/index.js'
import { BlockCache } from '../../src/experimental/block-cache.js'
import { Tokenizer, normalizeMarkdown } from '../../src/core/tokenizer.js'
import { allBlockRules } from '../../src/blocks/rules.js'

const options = { gfm: true, allowHtml: true, lazyImages: false }
const cases = {
  fence: '  ````js caption="😀"\n' + '  const value = `\\u{1f600}`;\n'.repeat(80),
  table: '| a | b |\n| :-- | --: |\n' + '| **😀** | a\\|b |\n'.repeat(80),
  list: '- [x] first\n' + '- **next**\n'.repeat(80),
  quote: '> first\n' + '>\n> **next**\n'.repeat(80),
  listFence: '- ```js\n' + '  const value = 1;\n'.repeat(80),
  quoteTable: '> | a | b |\n> | -- | -- |\n' + '> | **😀** | row |\n'.repeat(80),
  nested: '> - ```js\n' + '>   const value = 1;\n'.repeat(80),
}

function structural() {
  const tokenizer = new Tokenizer(options, allBlockRules)
  const cache = new BlockCache({ checkpoints: 4096, nodes: 50_000, units: 1_000_000 }, () => {})
  return { cache, check(source: string) {
    const budget = { limit: 100_000, remaining: 100_000 }, fullBudget = { limit: 100_000, remaining: 100_000 }
    const actual = cache.parse(source, budget, tokenizer.resume.bind(tokenizer))
    expect(actual).toEqual(tokenizer.tokenize(source, fullBudget))
    expect(budget.remaining).toBe(fullBudget.remaining)
    let offset = 0
    const normalized = normalizeMarkdown(source)
    for (const token of actual) {
      const start = normalized.indexOf(token.raw, offset)
      expect(start).toBeGreaterThanOrEqual(offset)
      expect(normalized.slice(offset, start).trim()).toBe('')
      offset = start + token.raw.length
    }
    expect(normalized.slice(offset).trim()).toBe('')
    return actual
  } }
}

describe('open block continuation', () => {
  it.each(Object.entries(cases))('continues %s with exact tokens, budgets, and immutable snapshots', (name, source) => {
    const { cache, check } = structural()
    const parser = createParser(options)
    const session = createIncrementalMarkdown({ parser: options, maxWorkCodeUnits: 500_000_000 })
    let before = '', earlier: unknown, copy: unknown
    for (let end = 53; end < source.length + 53; end += 53) {
      const next = source.slice(0, end)
      check(next)
      const result = session.append(next.slice(before.length))
      expect(result).toEqual(parser.parseDocument(next))
      if (earlier) expect(earlier).toEqual(copy)
      earlier = result; copy = structuredClone(result); before = next
    }
    expect(cache.metrics.continuationHits).toBeGreaterThan(5)
    expect(cache.metrics.continuedCodeUnits).toBeGreaterThan(source.length * 3)
    if (name === 'nested') expect(cache.metrics.continuationHits).toBeGreaterThan(source.length / 53)
    const retained = check(source), snapshot = structuredClone(retained)
    for (const next of [source + '\n- loose\n', source.slice(0, source.length / 2), source,
      source.replace('js', 'text').replace(':--', '--:'), source.replaceAll('> ', '>\t'),
      '# Earlier\n\n' + source, source, source + '``', source + '````\n\n# After\n']) check(next)
    expect(retained).toEqual(snapshot)
    session.dispose()
    expect(session.metrics.cachedBlockTokens).toBe(0)
  })

  it.each([
    '- a\n\n- b\n\n  > quote\n  >\n  > tail\n',
    '> - a\n>   continuation\n>\n> - [ ] b\n>\n>   tail\n',
    '- ```\n  code\n  ```\n\n- end\n',
    '> a\ncontinued\n> b\n> ---\n> tail\n',
    '- a\n  b\n\n  | x | y |\n  | - | - |\n  | row | value |\n',
    '  ~~~~ js\r\n\tvalue😀\r\n  ~~~\r\n  ~~~~\r\n',
  ])('revisits container and delimiter boundaries: %j', source => {
    const { check } = structural()
    // Repeated small edits retain a useful frontier while changing earlier grammar decisions.
    for (let index = 0; index <= source.length; index++) {
      check(source)
      check(source.slice(0, index))
      check(source)
      check(source.slice(0, index) + source.slice(index + 1))
      check(source.slice(0, index) + '\n' + source.slice(index))
    }
  })

  it('preserves nested structures through 1500 deterministic tail edits', () => {
    let seed = 0x851b
    const random = (max: number) => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) % max }
    const { check } = structural()
    const parts = ['- [x] item\n', '  continued\n', '\n', '> text\n', '>\n', '  ```js\n',
      '  const value = 1;\n', '  ```\n', '| a | b |\n', '| - | - |\n', '| row | value |\n', '[r]: /url\n', '  > - nested\n']
    for (let batch = 0; batch < 30; batch++) {
      let source = Object.values(cases)[batch % 7]
      check(source)
      for (let edit = 0; edit < 50; edit++) {
        const cut = random(4) === 0 ? random(Math.min(source.length, 100)) : 0
        source = source.slice(0, source.length - cut) + parts[random(parts.length)]
        check(source)
      }
    }
  })

  it('invalidates child lazy flags when stripped text is unchanged', () => {
    const { check } = structural()
    for (let count = 0; count < 10; count++) for (const source of [
      '> first\n> second\n> ---\n> end\n', '> first\nsecond\n> ---\n> end\n',
      '- first\n  second\n  ---\n  end\n', '- first\nsecond\n  ---\n  end\n',
      '> - first\n>   second\n>   ---\n>   end\n', '> - first\nsecond\n>   ---\n>   end\n',
    ]) check(source)
  })

  it.each([{ maxCachedBlockTokens: 50 }, { maxCachedBlockCodeUnits: 500 }, { maxBlockCheckpoints: 0 }])(
    'bounds nested retention and preserves complete output: %j', limits => {
      const parser = createParser(options), session = createIncrementalMarkdown({ parser: options, ...limits })
      for (const source of [cases.nested, cases.nested + '>   final\n']) {
        expect(session.update(source)).toEqual(parser.parseDocument(source))
        expect(session.metrics.cachedBlockTokens).toBe(0)
        expect(session.metrics.cachedBlockCodeUnits).toBe(0)
      }
    })

  it('releases nested state after cumulative work exhaustion', () => {
    const session = createIncrementalMarkdown({ parser: options, maxWorkCodeUnits: 100_000 })
    session.update(cases.nested)
    expect(session.metrics.cachedBlockTokens).toBeGreaterThan(0)
    expect(() => { for (let i = 0; i < 100; i++) session.append('>   more\n') }).toThrow('maxWorkCodeUnits')
    expect(session.metrics.sourceLength).toBe(0)
    expect(session.metrics.cachedBlockCodeUnits).toBe(0)
    expect(() => session.append('')).toThrow('closed')
  })
})
