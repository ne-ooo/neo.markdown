import { createRequire } from 'node:module'
import { describe, expect, it, vi } from 'vitest'
import { createIncrementalMarkdown } from '../../src/experimental/incremental.js'
import { createParser } from '../../src/index.js'
import { tocPlugin } from '../../src/plugins/toc.js'
import { codePresentationPlugin } from '../../src/plugins/code-presentation.js'
import { copyCodePlugin } from '../../src/plugins/copy-code.js'
import { sanitizeHtml } from '../../src/sanitizers/structural.js'
import type { MarkdownPlugin } from '../../src/core/types.js'
import gfm from '../fixtures/gfm-official.json'
const require = createRequire(import.meta.url)
const commonmark = require('commonmark-spec').tests as Array<{ number: number; markdown: string }>

describe('incremental Markdown complete-input parity', () => {
  it.each(commonmark)('preserves CommonMark output through chunks: $number', fixture => {
    const source = fixture.markdown.replaceAll('→', '\t')
    const options = { allowHtml: true, gfm: false, lazyImages: false }
    const session = createIncrementalMarkdown({ parser: options })
    const parser = createParser(options)
    let prefix = ''
    for (let offset = 0; offset < source.length; offset += 13) {
      const chunk = source.slice(offset, offset + 13); prefix += chunk
      expect(session.append(chunk)).toEqual(parser.parseDocument(prefix))
    }
    expect(session.update(source)).toEqual(parser.parseDocument(source))
    session.dispose()
  })
  it.each(gfm.examples)('preserves normative GFM output through chunks: $example', fixture => {
    const options = { allowHtml: true, gfm: true, lazyImages: false }
    const session = createIncrementalMarkdown({ parser: options }), parser = createParser(options)
    let prefix = ''
    for (let offset = 0; offset < fixture.markdown.length; offset += 7) {
      const chunk = fixture.markdown.slice(offset, offset + 7); prefix += chunk
      expect(session.append(chunk)).toEqual(parser.parseDocument(prefix))
    }
    expect(session.update(fixture.markdown)).toEqual(parser.parseDocument(fixture.markdown)); session.dispose()
  })
  it('reuses unchanged inline work and invalidates earlier links after reference changes', () => {
    const session = createIncrementalMarkdown(), parser = createParser()
    const original = 'A **stable paragraph**.\n\n[Earlier][target]\n'
    session.update(original); session.update(original + '\nA new paragraph.\n')
    expect(session.metrics.reusedInlineCodeUnits).toBeGreaterThan(0)
    for (const suffix of ['\n[target]: /one\n', '\n[target]: /two "title"\n', '\n[target]: javascript:alert(1)\n', '']) {
      expect(session.update(original + suffix)).toEqual(parser.parseDocument(original + suffix))
    }
    expect(session.metrics.referenceInvalidations).toBe(4)
  })
  it('updates lists, tables, setext headings, blockquotes, fences, CRLF, and partial Unicode', () => {
    const session = createIncrementalMarkdown({ parser: { gfm: true } }), parser = createParser({ gfm: true })
    const values = ['a\r', 'a\r\n---\r\n', '- one\n\n- two\n', '- one\n  continuation\n', '> quoted\n', '> - nested\n',
      'a | b\n- | -\n', 'a | b\n- | -\nnew | row\n', '```js\nconst x = `', '```js\nconst x = `😀`;\n```\n', '\ud83d', '😀']
    for (const source of values) expect(session.update(source)).toEqual(parser.parseDocument(source))
  })
  it('preserves document assets, diagnostics, TOC data, and plugin calls', () => {
    const factory = () => [tocPlugin(), codePresentationPlugin(), copyCodePlugin()]
    const session = createIncrementalMarkdown({ parser: { plugins: factory() } }), parser = createParser({ plugins: factory() })
    for (const source of ['# Heading\n\n```text caption=Example focus=bad\nhello\n```', '# Heading\n\n# Heading\n', 'plain']) {
      expect(session.update(source)).toEqual(parser.parseDocument(source))
    }
    expect(session.metrics.cacheEntries).toBe(0)
    expect(() => session.update('# Heading', { maxTocEntries: 0 })).toThrow('maxTocEntries')
  })
})

describe('incremental Markdown cache and resource boundaries', () => {
  it('preserves UGC token budgets when repeated text uses cached tokens', () => {
    const session = createIncrementalMarkdown({ parser: { ugc: true }, maxWorkCodeUnits: 10_000_000 })
    session.update('**text**')
    const source = '**text**\n\n'.repeat(18_000)
    expect(() => createParser({ ugc: true }).parseDocument(source)).toThrow(/token count/)
    expect(() => session.update(source)).toThrow(/token count/)
    expect(session.metrics.cacheEntries).toBe(0)
  })
  it('does not memoize custom rules with observable external state', () => {
    const custom = vi.fn(() => null)
    const plugin: MarkdownPlugin = builder => builder.addInlineRule({ name: 'probe', priority: 2000, tokenize: custom })
    const session = createIncrementalMarkdown({ parser: { plugins: [plugin] } })
    session.update('hello'); const calls = custom.mock.calls.length
    session.update('hello'); expect(custom.mock.calls.length).toBeGreaterThan(calls)
    expect(session.metrics.reusedInlineCodeUnits).toBe(0)
  })
  it('preserves sanitizer and URL restrictions after cache reuse', () => {
    const options = { allowHtml: true, sanitize: true, sanitizer: sanitizeHtml }
    const session = createIncrementalMarkdown({ parser: options }), parser = createParser(options)
    for (const source of ['<img src=x onerror=alert(1)>\n\nA **paragraph**.',
      '[click][x]\n\n[x]: javascript:alert(1)', '[click][x]\n\n[x]: https://example.com',
      '<a href="javascript:alert(1)" onclick="bad()">x</a>\n\nA **paragraph**.']) {
      expect(session.update(source)).toEqual(parser.parseDocument(source))
      expect(session.update(source).html).not.toMatch(/onclick|onerror|href="javascript:/)
    }
  })
  it('evicts old entries and bounds retained source, nodes, and token strings', () => {
    const session = createIncrementalMarkdown({ maxEntries: 2, maxCachedCodeUnits: 12, maxCachedTokens: 3, maxCachedTokenCodeUnits: 100 })
    for (const source of ['one', 'two', 'three', '**four**', 'a paragraph that exceeds the entry budget']) {
      expect(session.update(source)).toEqual(createParser().parseDocument(source))
      expect(session.metrics.cacheEntries).toBeLessThanOrEqual(2); expect(session.metrics.cachedCodeUnits).toBeLessThanOrEqual(12)
      expect(session.metrics.cachedTokens).toBeLessThanOrEqual(3); expect(session.metrics.cachedTokenCodeUnits).toBeLessThanOrEqual(100)
    }
    const disabled = createIncrementalMarkdown({ maxEntries: 0 }); disabled.update('text'); expect(disabled.metrics.cacheEntries).toBe(0)
  })
  it('bounds expanded reference strings in cache entries', () => {
    const session = createIncrementalMarkdown({ maxCachedTokenCodeUnits: 30 })
    const source = '[a][x]\n\n[x]: /' + 'long'.repeat(100)
    expect(session.update(source)).toEqual(createParser().parseDocument(source)); expect(session.metrics.cacheEntries).toBe(0)
  })
  it.each([
    [{ maxInputLength: 0 }, 'x', 'maxInputLength'],
    [{ maxUpdates: 0 }, '', 'maxUpdates'],
    [{ maxWorkCodeUnits: 1 }, 'x', 'maxWorkCodeUnits'],
  ] as const)('closes and clears the cache after limits: %j', (options, source, message) => {
    const session = createIncrementalMarkdown(options)
    expect(() => session.update(source)).toThrow(message); expect(session.metrics.cacheEntries).toBe(0); expect(session.metrics.sourceLength).toBe(0)
    expect(() => session.append('x')).toThrow('closed')
  })
  it('checks append bounds, malformed values, and disposal', () => {
    const session = createIncrementalMarkdown({ maxInputLength: 3 }); session.append('abc')
    expect(() => session.append('d')).toThrow('maxInputLength')
    const valid = createIncrementalMarkdown(); expect(() => valid.update(1 as any)).toThrow(TypeError); expect(() => valid.append(1 as any)).toThrow(TypeError)
    valid.dispose(); valid.dispose(); expect(() => valid.update('')).toThrow('closed')
    expect(() => createIncrementalMarkdown({ maxEntries: Infinity })).toThrow(RangeError)
  })
})
