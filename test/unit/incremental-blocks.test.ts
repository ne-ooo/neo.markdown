import { createRequire } from 'node:module'
import { describe, expect, it, vi } from 'vitest'
import { createIncrementalMarkdown } from '../../src/experimental/incremental.js'
import { createParser } from '../../src/index.js'
import type { ParserOptions } from '../../src/core/types.js'
import { Tokenizer, normalizeMarkdown } from '../../src/core/tokenizer.js'
import { allBlockRules } from '../../src/blocks/rules.js'
import { BlockCache } from '../../src/experimental/block-cache.js'
import gfm from '../fixtures/gfm-official.json'

const require = createRequire(import.meta.url)
const commonmark = require('commonmark-spec').tests as Array<{ number: number; markdown: string }>
const prefix = '# Stable\n\nA **retained** paragraph.\n\n'
const suffix = '\n\n# Following\n\nAnother **retained** paragraph.\n'

describe('resumable Markdown blocks', () => {
  it('preserves exact structural tokens and normalized source spans through boundary deletions', () => {
    const tokenizer = new Tokenizer({ gfm: true, allowHtml: true }, allBlockRules)
    const cache = new BlockCache({ checkpoints: 1000, nodes: 10_000, units: 100_000 }, () => {})
    const source = prefix + '- nested\r\n  > quote\r\n\r\na | b\n- | -\n\n~~~js caption=Example\ncode\0😀\n~~~\n\n[x]: /url\n"title\n# heading\nend"\n' + suffix
    const resume = tokenizer.resume.bind(tokenizer)
    expect(cache.parse(source, undefined, resume)).toEqual(tokenizer.tokenize(source))
    for (let index = 0; index < source.length; index++) {
      const next = source.slice(0, index) + source.slice(index + 1)
      const normalized = normalizeMarkdown(next)
      let previousEnd = 0, reconstructed = ''
      tokenizer.resume(next, 0, undefined, point => {
        expect(point.start).toBe(previousEnd)
        expect(point.dependencyEnd).toBeGreaterThan(point.end)
        expect(point.dependencyEnd).toBeLessThanOrEqual(normalized.length + 1)
        const span = normalized.slice(point.start, point.end)
        if (point.token) expect(span.endsWith(point.token.raw)).toBe(true)
        reconstructed += span; previousEnd = point.end
        return false
      })
      expect(reconstructed).toBe(normalized)
      expect(cache.parse(next, undefined, resume), JSON.stringify({ index, next })).toEqual(tokenizer.tokenize(next))
      expect(cache.parse(source, undefined, resume)).toEqual(tokenizer.tokenize(source))
    }
  })

  it.each(commonmark)('matches every CommonMark prefix after retained blocks: $number', fixture => {
    const parserOptions = { allowHtml: true, lazyImages: false }
    const session = createIncrementalMarkdown({ parser: parserOptions, maxWorkCodeUnits: 100_000_000 })
    const parser = createParser(parserOptions)
    let source = prefix
    session.update(source)
    for (const unit of fixture.markdown.replaceAll('→', '\t').split('')) {
      source += unit
      expect(session.append(unit), JSON.stringify(source)).toEqual(parser.parseDocument(source))
    }
    expect(session.append(suffix)).toEqual(parser.parseDocument(source + suffix))
    expect(session.metrics.reusedBlocks).toBeGreaterThan(0)
    session.dispose()
  })

  it.each(gfm.examples)('matches GFM prefixes and delimiter edits with retained surroundings: $example', fixture => {
    const parserOptions = { gfm: true, allowHtml: true, lazyImages: false }
    const session = createIncrementalMarkdown({ parser: parserOptions, maxWorkCodeUnits: 100_000_000 })
    const parser = createParser(parserOptions)
    let source = prefix
    session.update(source)
    for (const unit of fixture.markdown.split('')) {
      source += unit
      expect(session.append(unit), JSON.stringify(source)).toEqual(parser.parseDocument(source))
    }
    source += suffix
    session.update(source)
    for (const delimiter of ['|', '\n', '-', '~', '[', '<']) {
      const at = source.indexOf(delimiter, prefix.length)
      if (at < 0) continue
      const next = source.slice(0, at) + source.slice(at + 1)
      expect(session.update(next), JSON.stringify(next)).toEqual(parser.parseDocument(next))
      expect(session.update(source)).toEqual(parser.parseDocument(source))
    }
  })

  it('restarts at the first changed dependency and reuses a converged suffix', () => {
    const paragraphs = Array.from({ length: 80 }, (_, i) => `Paragraph ${i} with **content**.\n\n`)
    const source = paragraphs.join('')
    const session = createIncrementalMarkdown(), parser = createParser()
    session.update(source)
    const before = session.metrics
    const next = source.replace('Paragraph 40', 'Replaced paragraph 40')
    expect(session.update(next)).toEqual(parser.parseDocument(next))
    expect(session.metrics.lastBlockRestart).toBeGreaterThan(0)
    expect(session.metrics.lastBlockParsedThrough).toBeLessThan(next.length)
    expect(session.metrics.parsedBlocks - before.parsedBlocks).toBeLessThan(5)
    expect(session.metrics.reusedBlocks - before.reusedBlocks).toBeGreaterThan(75)
    const parsed = session.metrics.parsedBlocks
    expect(session.update(next)).toEqual(parser.parseDocument(next))
    expect(session.metrics.parsedBlocks).toBe(parsed)
  })

  it.each([
    ['[x]: /url\n"unfinished\n# Later\nmore\n', '"\n'],
    ['[unfinished\n\n# Later\n', 'label]: /url\n'],
    ['    chunk1\n\n    chunk2\n\n\n', '    chunk3\n'],
    ['- one\n\n', '- two\n\n  continued\n'],
    ['> - one\n>\n>   nested\n', '>\n> - two\n'],
    ['a | b\n', '- | -\nnew | row\n'],
    ['Heading\n', '---\n'],
    ['```js\nconst x = 1;\n``', '`\n# After\n'],
    ['~~~\n[x]: /inside\n', '~~~\n[x]: /outside\n'],
    ['<div>\nline\nline\n  ', 'continued\n\n'],
    ['text\r', '\n\n- a\r\n- b\r\n'],
    ['\ud83d', '\ude00\0\r\n'],
  ])('tracks an unfinished dependency: %j', (initial, added) => {
    const options = { gfm: true, allowHtml: true }
    const session = createIncrementalMarkdown({ parser: options }), parser = createParser(options)
    let source = prefix + initial
    session.update(source)
    for (const chunk of added.split('')) {
      source += chunk
      expect(session.append(chunk), JSON.stringify(source)).toEqual(parser.parseDocument(source))
    }
    expect(session.update(prefix + initial)).toEqual(parser.parseDocument(prefix + initial))
  })

  it('invalidates a definition whose optional title reads beyond several emitted blocks', () => {
    const initial = prefix + '[x]: /url\n"title\n# One\n# Two\n# Three\n\n[x]\n' + suffix
    const next = initial.replace('# Three', '# Three"')
    const session = createIncrementalMarkdown(), parser = createParser()
    session.update(initial)
    expect(session.update(next)).toEqual(parser.parseDocument(next))
    expect(session.metrics.lastBlockRestart).toBeLessThanOrEqual(prefix.length)
    expect(session.update(initial)).toEqual(parser.parseDocument(initial))
  })

  it('tracks resolved, unresolved, duplicate, nested, and removed reference definitions', () => {
    const session = createIncrementalMarkdown(), parser = createParser()
    const text = 'Stable **text**.\n\n[First][a]\n\n[Second][b]\n\n[Missing][c]\n\n'
    let source = text + '[a]: /a\n[b]: /b\n'
    session.update(source)
    const before = session.metrics
    source = text + '[a]: /new-a\n[b]: /b\n'
    expect(session.update(source)).toEqual(parser.parseDocument(source))
    expect(session.metrics.invalidatedInlineEntries - before.invalidatedInlineEntries).toBe(1)
    expect(session.metrics.parsedInlineCodeUnits - before.parsedInlineCodeUnits).toBe('[First][a]'.length)
    for (const definitions of [
      '[a]: /a\n[a]: /ignored\n[b]: /b\n[c]: /c\n',
      '> [a]: /quote\n\n- [b]: /list\n',
      '```\n[a]: /code\n```\n\n[b]: /b\n',
      '[a]: javascript:alert(1)\n[b]: /b "changed title"\n', '',
    ]) {
      source = text + definitions
      expect(session.update(source)).toEqual(parser.parseDocument(source))
    }
  })

  it('preserves complete results through 4000 deterministic edits', () => {
    let seed = 0x9e3779b9
    const random = (max: number) => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) % max }
    const fragments = ['\n', '\r', '\r\n', ' ', '\t', '|', '- ', '1. ', '> ', '```\n', '~~~\n', '\n---\n',
      '[a]: /url\n', '[a]: /changed "title"\n', '"', '\\', '# Heading\n', '[link][a]', '**bold**', '<div>\n', '\n</div>\n', '😀', '\0']
    for (const options of [{ gfm: true, allowHtml: true }, { gfm: false, allowHtml: false }] satisfies ParserOptions[]) {
      const session = createIncrementalMarkdown({ parser: options, maxWorkCodeUnits: 1_000_000_000 })
      const parser = createParser(options)
      let source = prefix + '- one\n\n- two\n\na | b\n- | -\n\n[a]\n\n[a]: /url\n' + suffix
      session.update(source)
      for (let step = 0; step < 2000; step++) {
        const start = random(source.length + 1), end = Math.min(source.length, start + random(20))
        const text = random(4) ? fragments[random(fragments.length)] : ''
        const next = source.slice(0, start) + text + source.slice(end)
        expect(session.update(next), JSON.stringify({ step, source, start, end, text, next })).toEqual(parser.parseDocument(next))
        source = next
      }
      session.dispose()
    }
  })
})

describe('block and reference retention limits', () => {
  it('replays structural UGC charges for reused blocks', () => {
    const options = { ugc: true }
    const session = createIncrementalMarkdown({ parser: options, maxBlockCheckpoints: 30_000 })
    const source = '---\n'.repeat(25_000)
    session.update(source)
    expect(session.metrics.blockCheckpoints).toBe(25_000)
    const next = source + '---\n'.repeat(25_001)
    expect(() => createParser(options).parseDocument(next)).toThrow(/token count/)
    expect(() => session.update(next)).toThrow(/token count/)
    expect(session.metrics.blockCheckpoints).toBe(0)
    expect(session.metrics.sourceLength).toBe(0)
  })

  it.each([
    { maxBlockCheckpoints: 0 }, { maxBlockCheckpoints: 2 },
    { maxCachedBlockTokens: 0 }, { maxCachedBlockTokens: 2 },
    { maxCachedBlockCodeUnits: 0 }, { maxCachedBlockCodeUnits: 20 },
  ])('discards block retention at its capacity without changing output: %j', limits => {
    const session = createIncrementalMarkdown(limits), parser = createParser()
    const source = '# One\n\n- first\n- second\n\n    code\n\nlast\n'
    expect(session.update(source)).toEqual(parser.parseDocument(source))
    expect(session.metrics.blockCheckpoints).toBe(0)
    expect(session.update(source + '\nnew')).toEqual(parser.parseDocument(source + '\nnew'))
    expect(session.metrics.cachedBlockTokens).toBe(0)
    expect(session.metrics.cachedBlockCodeUnits).toBe(0)
  })

  it('bounds reference dependencies without changing lookup behavior', () => {
    const session = createIncrementalMarkdown({ maxCachedReferenceDependencies: 1 })
    const parser = createParser()
    for (const source of ['[a]\n\n[b]\n\n[a]: /a\n[b]: /b\n', '[a] [b]\n\n[a]: /a\n[b]: /b\n', '[a]\n\n[a]: /changed\n']) {
      expect(session.update(source)).toEqual(parser.parseDocument(source))
      expect(session.metrics.cachedReferenceDependencies).toBeLessThanOrEqual(1)
    }
    const none = createIncrementalMarkdown({ maxCachedReferenceDependencies: 0 })
    none.update('[missing]')
    expect(none.metrics.cacheEntries).toBe(0)
  })

  it('preserves observable custom block calls and releases all retained state', () => {
    const tokenize = vi.fn(() => null)
    const session = createIncrementalMarkdown({ parser: { plugins: [builder => builder.addBlockRule({ name: 'probe', tokenize })] } })
    session.update('text'); const before = tokenize.mock.calls.length
    session.update('text')
    expect(tokenize.mock.calls.length).toBeGreaterThan(before)
    expect(session.metrics.blockCheckpoints).toBe(0)
    const retained = createIncrementalMarkdown()
    retained.update(prefix + '[a]\n\n[a]: /url\n')
    expect(retained.metrics.blockCheckpoints).toBeGreaterThan(0)
    retained.dispose(); retained.dispose()
    expect(retained.metrics.blockCheckpoints).toBe(0)
    expect(retained.metrics.cachedReferenceDependencies).toBe(0)
    expect(() => retained.update('')).toThrow('closed')
  })

  it.each(['maxBlockCheckpoints', 'maxCachedBlockTokens', 'maxCachedBlockCodeUnits', 'maxCachedReferenceDependencies'])('rejects invalid %s', option => {
    expect(() => createIncrementalMarkdown({ [option]: Infinity })).toThrow(RangeError)
    expect(() => createIncrementalMarkdown({ [option]: -1 })).toThrow(RangeError)
  })
})
