import { describe, it, expect, vi } from 'vitest'
import { createRequire } from 'node:module'
import { createParser } from '../../src/index.js'
import { createIncrementalMarkdown, defineIncrementalPlugin } from '../../src/experimental/index.js'
import { tocPlugin } from '../../src/plugins/toc.js'
import { codePresentationPlugin } from '../../src/plugins/code-presentation.js'
import { copyCodePlugin } from '../../src/plugins/copy-code.js'
import { sanitizeHtml } from '../../src/sanitizers/structural.js'
import type { MarkdownPlugin, InlineRule, InlineToken, PluginBuilder, BlockToken } from '../../src/core/types.js'
import gfm from '../fixtures/gfm-official.json'

const commonmark = createRequire(import.meta.url)('commonmark-spec').tests as Array<{ markdown: string }>

const declare = (plugin: MarkdownPlugin, read?: () => string, id = 'inline') => defineIncrementalPlugin(plugin, {
  protocol: 1, id, profile: 'inline', effects: 'none', dependencies: read ? { kind: 'revision', read } : { kind: 'static' },
})
const render = (plugin: MarkdownPlugin, id: string) => defineIncrementalPlugin(plugin, { protocol: 1, profile: 'render', id })
const code = (raw = '@neo', text = raw): { token: InlineToken; raw: string } => ({ token: { type: 'code', raw, text }, raw })
const source = '# Hello @neo\n\n@neo and **@neo** [link][ref]\n\n@neo and **@neo** [link][ref]\n\n[ref]: /one\n\n> - ```js caption=Example\n>   const x = 1;\n'

describe('pure inline dependencies', () => {
  it('preserves all CommonMark and normative GFM fixtures with an eligible no-match inline rule', () => {
    for (const [fixtures, enabled] of [[commonmark, false], [gfm.examples, true]] as const) {
      const plugin = declare(builder => builder.addInlineRule({ name: 'no-match', triggerChars: [64], tokenize: () => null }))
      const options = { allowHtml: true, gfm: enabled, lazyImages: false, plugins: [plugin] }
      const session = createIncrementalMarkdown({ pluginReuse: 'declared', parser: options, maxWorkCodeUnits: 100_000_000 })
      const parser = createParser(options)
      for (const fixture of fixtures) {
        const text = fixture.markdown.replaceAll('→', '\t')
        expect(session.update(text)).toEqual(parser.parseDocument(text))
        expect(session.update(text)).toEqual(parser.parseDocument(text))
      }
      session.dispose()
    }
  })

  it('reuses deterministic rules while repeating downstream effects and preserving token spans', () => {
    const make = () => {
      const tokenize = vi.fn((src: string) => src.startsWith('@neo') ? code() : null)
      const graphs: BlockToken[][] = [], toc = vi.fn()
      const plugins = [declare(builder => {
        builder.addInlineRule({ name: 'mention', triggerChars: [64], tokenize })
        builder.addTokenTransform(tokens => { graphs.push(structuredClone(tokens)); return tokens })
      }), render(tocPlugin({ onToc: toc }), 'toc'), render(codePresentationPlugin(), 'presentation'), render(copyCodePlugin(), 'copy')]
      return { tokenize, graphs, toc, options: { gfm: true, plugins, allowHtml: true, sanitize: true, sanitizer: sanitizeHtml } }
    }
    const actual = make(), expected = make()
    const session = createIncrementalMarkdown({ pluginReuse: 'declared', parser: actual.options })
    const parser = createParser(expected.options)
    for (const text of [source, source, source.replace('/one', '/two'), source + '>   const y = 2;\n', '# Earlier\n\n' + source]) {
      expect(session.update(text)).toEqual(parser.parseDocument(text))
      expect(actual.graphs.at(-1)).toEqual(expected.graphs.at(-1))
      expect(actual.toc.mock.calls).toEqual(expected.toc.mock.calls)
    }
    expect(session.reuse.mode).toBe('declared')
    expect(actual.tokenize.mock.calls.length).toBeLessThan(expected.tokenize.mock.calls.length)
    expect(session.metrics.reusedBlocks).toBeGreaterThan(0)
    expect(session.metrics.pluginInvalidations).toBe(0)
    session.dispose()
  })

  it('samples ordered revision vectors once per attempt and clears the complete inline cache for A–B–A', () => {
    let a = 'a', b = 'b'
    const order: string[] = [], calls = vi.fn((src: string) => src.startsWith('@neo') ? code('@neo', a + b) : null)
    const one = declare(builder => builder.addInlineRule({ name: 'mention', triggerChars: [64], tokenize: calls }), () => { order.push('one'); return a }, 'one')
    const two = declare(() => {}, () => { order.push('two'); return b }, 'two')
    const session = createIncrementalMarkdown({ pluginReuse: 'declared', parser: { plugins: [one, two] } })
    const parser = createParser({ plugins: [one, two] })
    const text = '@neo\n\nplain [r]\n\n[r]: /one\n'
    for (const [nextA, nextB] of [['a', 'b'], ['a', 'b'], ['new', 'b'], ['a', 'b'], ['a', 'new']]) {
      a = nextA; b = nextB
      expect(session.update(text)).toEqual(parser.parseDocument(text))
    }
    expect(session.append('')).toEqual(parser.parseDocument(text))
    expect(order).toEqual(Array.from({ length: 6 }, () => ['one', 'two']).flat())
    expect(session.metrics.pluginInvalidations).toBe(3)
    expect(session.metrics.reusedBlocks).toBeGreaterThan(0)
    expect(session.metrics.referenceInvalidations).toBe(0)
    session.dispose()
    expect(session.metrics.cachedReferenceDependencies).toBe(0)
  })

  it('tracks render-time dependency changes on the next identical-source update', () => {
    const make = () => {
      let revision = 0
      return declare(builder => {
        builder.addInlineRule({ name: 'revision', triggerChars: [64], tokenize: src => src.startsWith('@neo') ? code('@neo', String(revision)) : null })
        builder.addHtmlTransform(html => { revision++; return html })
      }, () => String(revision))
    }
    const session = createIncrementalMarkdown({ pluginReuse: 'declared', parser: { plugins: [make()] } })
    const parser = createParser({ plugins: [make()] })
    for (let i = 0; i < 4; i++) expect(session.update('@neo')).toEqual(parser.parseDocument('@neo'))
    expect(session.metrics.pluginInvalidations).toBe(3)
  })

  it('compares vector entries directly and keeps independent sessions isolated', () => {
    let first = 'ab', second = 'c'
    const make = () => [declare(builder => builder.addInlineRule({ name: 'value', triggerChars: [64], tokenize: () => code('@neo', first + ':' + second) }), () => first),
      declare(() => {}, () => second, 'second')]
    const one = createIncrementalMarkdown({ pluginReuse: 'declared', parser: { plugins: make() } })
    const two = createIncrementalMarkdown({ pluginReuse: 'declared', parser: { plugins: make() } })
    expect(one.update('@neo').html).toContain('ab:c')
    first = 'a'; second = 'bc'
    expect(one.update('@neo').html).toContain('a:bc')
    expect(one.metrics.pluginInvalidations).toBe(1)
    expect(two.update('@neo').html).toContain('a:bc')
    expect(two.metrics.pluginInvalidations).toBe(0)
    one.dispose()
    expect(two.update('@neo').html).toContain('a:bc')
  })

  it('matches complete tokens through Unicode chunk boundaries and reference edits', () => {
    const make = (graphs: BlockToken[][]) => declare(builder => {
      builder.addInlineRule({ name: 'emoji', triggerChars: [58], priority: 'before:text', tokenize: src => src.startsWith(':😀:') ? code(':😀:', 'emoji') : null })
      builder.addTokenTransform(tokens => { graphs.push(structuredClone(tokens)); return tokens })
    })
    const actual: BlockToken[][] = [], expected: BlockToken[][] = []
    const session = createIncrementalMarkdown({ pluginReuse: 'declared', parser: { gfm: true, plugins: [make(actual)] } })
    const parser = createParser({ gfm: true, plugins: [make(expected)] })
    const text = '# :😀:\r\n\r\n- **:😀:** [r]\n\n| :😀: | x |\n| - | - |\n| [r] | :😀: |\n\n[r]: /one\n'
    for (let i = 1; i <= text.length; i++) {
      expect(session.append(text[i - 1])).toEqual(parser.parseDocument(text.slice(0, i)))
      expect(actual.at(-1)).toEqual(expected.at(-1))
    }
    for (const next of [text.replace('/one', '/two'), text.replace('[r]: /one', ''), text]) {
      expect(session.update(next)).toEqual(parser.parseDocument(next))
      expect(actual.at(-1)).toEqual(expected.at(-1))
    }
  })

  it.each([undefined, null, 1, {}, new String('x'), Promise.resolve('x')])('rejects non-string revisions before tokenization: %s', value => {
    const tokenize = vi.fn(() => null), html = vi.fn((html: string) => html)
    const plugin = declare(builder => { builder.addInlineRule({ name: 'probe', tokenize }); builder.addHtmlTransform(html) }, () => value as string)
    const session = createIncrementalMarkdown({ pluginReuse: 'declared', parser: { plugins: [plugin] } })
    expect(() => session.update('text')).toThrow(TypeError)
    expect(tokenize).not.toHaveBeenCalled(); expect(html).not.toHaveBeenCalled()
    expect(() => session.update('text')).toThrow('closed')
  })

  it('bounds revisions, propagates getter failures, and releases an existing generation', () => {
    let revision = 'x'.repeat(1024)
    const error = new Error('revision failed')
    const plugin = declare(builder => builder.addInlineRule({ name: 'probe', tokenize: () => null }), () => { if (revision === 'throw') throw error; return revision })
    for (const failure of ['throw', 'x'.repeat(1025)]) {
      revision = 'x'.repeat(1024)
      const session = createIncrementalMarkdown({ pluginReuse: 'declared', parser: { plugins: [plugin] } })
      session.update('cached')
      revision = failure
      expect(() => session.update('cached')).toThrow(failure === 'throw' ? error : RangeError)
      expect(session.metrics.cacheEntries).toBe(0)
      expect(session.metrics.blockCheckpoints).toBe(0)
      expect(session.metrics.sourceLength).toBe(0)
    }
  })

  it('accepts the maximum ordered revision vector without retaining historical generations', () => {
    let generation = 0
    const readers = Array.from({ length: 64 }, (_, i) => vi.fn(() => String(generation).padEnd(1024, String(i % 10))))
    const plugins = readers.map((read, i) => declare(() => {}, read, String(i)))
    const session = createIncrementalMarkdown({ pluginReuse: 'declared', parser: { plugins }, maxWorkCodeUnits: 10_000_000 })
    for (let i = 0; i < 4; i++) { generation = i % 2; session.update('text') }
    expect(session.metrics.pluginInvalidations).toBe(3)
    expect(readers.every(read => read.mock.calls.length === 4)).toBe(true)
    expect(session.metrics.cacheEntries).toBe(1)
  })

  it.each([
    { maxInputLength: 0 }, { maxUpdates: 0 }, { parser: { maxInputLength: 0 } }, { maxWorkCodeUnits: 0 },
  ])('applies input, update, and work limits before revision sampling: %j', limits => {
    const read = vi.fn(() => 'revision')
    const session = createIncrementalMarkdown({ ...limits, pluginReuse: 'declared', parser: { ...limits.parser, plugins: [declare(() => {}, read)] } })
    expect(() => session.update('text')).toThrow(RangeError)
    expect(read).not.toHaveBeenCalled()
  })

  it('applies the UGC input cap before getters and charges empty-source revision reads', () => {
    const read = vi.fn(() => 'x')
    const session = createIncrementalMarkdown({ maxInputLength: 2_000_000, pluginReuse: 'declared', parser: { ugc: true, plugins: [declare(() => {}, read)] } })
    expect(() => session.update('x'.repeat(1_000_001))).toThrow('maxInputLength')
    expect(read).not.toHaveBeenCalled()
    const empty = createIncrementalMarkdown({ maxWorkCodeUnits: 0, pluginReuse: 'declared', parser: { plugins: [declare(() => {}, read)] } })
    expect(() => empty.append('')).toThrow('maxWorkCodeUnits')
    expect(read).not.toHaveBeenCalled()
  })
})

describe('guarded inline callbacks and setup metadata', () => {
  it.each(['inline', 'revision'] as const)('guards all scopes and retained render functions during %s callbacks', phase => {
    for (const operation of ['document', 'renderInline', 'renderBlock', 'retainedInline', 'retainedBlock']) {
      let other: PluginBuilder, retainedInline: PluginBuilder['renderInline'], retainedBlock: PluginBuilder['renderBlock']
      const access = () => {
        try {
          if (operation === 'document') void other.document
          if (operation === 'renderInline') void other.renderInline
          if (operation === 'renderBlock') void other.renderBlock
          if (operation === 'retainedInline') retainedInline([])
          if (operation === 'retainedBlock') retainedBlock([])
        } catch { /* The guard must still prevent tokenization or rendering from continuing. */ }
      }
      const effects = vi.fn((html: string) => html)
      const plugins = [render(builder => { other = builder; retainedInline = builder.renderInline; retainedBlock = builder.renderBlock; builder.addHtmlTransform(effects) }, 'render'),
        declare(builder => builder.addInlineRule({ name: 'guard', triggerChars: [64], tokenize: () => { if (phase === 'inline') access(); return code() } }),
          phase === 'revision' ? () => { access(); return 'x' } : undefined)]
      const session = createIncrementalMarkdown({ pluginReuse: 'declared', parser: { plugins } })
      expect(() => session.update('@neo'), operation).toThrow('closed')
      expect(effects).not.toHaveBeenCalled()
      expect(session.metrics.cacheEntries).toBe(0)
    }
  })

  it('rejects uncaught phase access and late inline registrations without retrying', () => {
    for (const late of [false, true]) {
      const tokenize = vi.fn(function (this: InlineRule) { return code() })
      const session = createIncrementalMarkdown({ pluginReuse: 'declared', parser: { plugins: [declare(builder => {
        builder.addInlineRule({ name: 'guard', triggerChars: [64], tokenize: src => {
          if (late) builder.addInlineRule({ name: 'later', tokenize })
          else builder.renderBlock([])
          return code(src)
        } })
      })] } })
      expect(() => session.update('@neo')).toThrow(late ? 'registration is closed' : 'cannot use rendering or document services')
      expect(tokenize).not.toHaveBeenCalled()
    }
  })

  it.each(['inline', 'revision'] as const)('rejects reentrancy and disposal during %s before any downstream callback', phase => {
    for (const operation of ['update', 'append', 'dispose'] as const) {
      let session: ReturnType<typeof createIncrementalMarkdown>
      const attempt = () => { try { operation === 'dispose' ? session.dispose() : session[operation]('nested') } catch {} }
      const render = vi.fn((html: string) => html)
      session = createIncrementalMarkdown({ pluginReuse: 'declared', parser: { plugins: [declare(builder => {
        builder.addInlineRule({ name: 'guard', triggerChars: [64], tokenize: () => { if (phase === 'inline') attempt(); return code() } })
        builder.addHtmlTransform(render)
      }, phase === 'revision' ? () => { attempt(); return 'x' } : undefined)] } })
      expect(() => session.update('@neo')).toThrow('closed')
      expect(render).not.toHaveBeenCalled()
      expect(session.metrics.blockCheckpoints).toBe(0)
    }
  })

  it('snapshots priorities, triggers, callbacks, and the documented rule receiver', () => {
    const tokenize = vi.fn(function (this: InlineRule, src: string) { return src.startsWith('*x*') ? code('*x*', this.name) : null })
    const rule: InlineRule = { name: 'first', priority: 'before:em', triggerChars: [42], tokenize }
    const session = createIncrementalMarkdown({ pluginReuse: 'declared', parser: { plugins: [declare(builder => builder.addInlineRule(rule))] } })
    rule.name = 'changed'; rule.priority = 'after:text'; rule.triggerChars!.length = 0; rule.tokenize = () => null
    expect(session.update('*x*').html).toBe('<p><code>first</code></p>\n')
    expect(session.update('*x*').html).toBe('<p><code>first</code></p>\n')
    expect(tokenize).toHaveBeenCalledTimes(1)
    expect(Object.isFrozen(tokenize.mock.instances[0])).toBe(true)
  })

  it('preserves original rule receivers and final setup metadata when a later registration selects fallback', () => {
    let seen: unknown
    const rule: InlineRule = { name: 'first', triggerChars: [64], tokenize(src) { seen = this; return src.startsWith('!') ? code('!', this.name) : null } }
    const plugin = declare(builder => {
      builder.addInlineRule(rule)
      rule.name = 'changed'; rule.triggerChars![0] = 33
      builder.addBlockRule({ name: 'fallback', tokenize: () => null })
    }, () => { throw new Error('revision must not run') })
    const session = createIncrementalMarkdown({ pluginReuse: 'declared', parser: { plugins: [plugin] } })
    expect(session.reuse.mode).toBe('fallback')
    expect(session.update('!').html).toContain('<code>changed</code>')
    expect(seen).toBe(rule)
  })

  it('falls back for accessor metadata without an extra getter read or a revision sample', () => {
    const make = () => {
      const get = vi.fn(() => [64]), read = vi.fn(() => 'x')
      const plugin = declare(builder => builder.addInlineRule({ name: 'accessor', get triggerChars() { return get() }, tokenize: src => src.startsWith('@neo') ? code() : null }), read)
      return { plugin, get, read }
    }
    const actual = make(), expected = make()
    const session = createIncrementalMarkdown({ pluginReuse: 'declared', parser: { plugins: [actual.plugin] } })
    const parser = createParser({ plugins: [expected.plugin] })
    expect(session.update('@neo')).toEqual(parser.parseDocument('@neo'))
    expect(session.reuse.blockers[0].code).toBe('registration-mismatch')
    expect(actual.get.mock.calls.length).toBe(expected.get.mock.calls.length)
    expect(actual.read).not.toHaveBeenCalled()
  })

  it('bounds aggregate rule metadata without discarding registrations', () => {
    const seen = vi.fn(() => null)
    const plugin = declare(builder => {
      for (let i = 0; i < 2; i++) builder.addInlineRule({ name: 'x'.repeat(33_000), tokenize: seen })
    })
    const session = createIncrementalMarkdown({ pluginReuse: 'declared', parser: { plugins: [plugin] } })
    expect(session.reuse.blockers[0].code).toBe('contract-limit')
    session.update('x')
    expect(seen).toHaveBeenCalledTimes(2)
  })
})

describe('custom inline snapshot ownership', () => {
  it('keeps accessor result envelopes uncached and guards accessors used by the tokenizer', () => {
    const calls = vi.fn(() => code())
    const plugin = declare(builder => builder.addInlineRule({ name: 'envelope', triggerChars: [64], tokenize: () => ({
      raw: '@neo', get token() { return calls().token },
    }) }))
    const session = createIncrementalMarkdown({ pluginReuse: 'declared', parser: { plugins: [plugin] } })
    session.update('@neo'); const firstCalls = calls.mock.calls.length
    session.update('@neo')
    expect(calls).toHaveBeenCalledTimes(firstCalls * 2)
    expect(session.metrics.cacheEntries).toBe(0)
    const effects = vi.fn((html: string) => html)
    const guarded = createIncrementalMarkdown({ pluginReuse: 'declared', parser: { plugins: [declare(builder => {
      builder.addHtmlTransform(effects)
      builder.addInlineRule({ name: 'getter', triggerChars: [64], tokenize: () => ({
        get raw() { try { void builder.document } catch {} return '@neo' }, token: code().token,
      }) })
    })] } })
    expect(() => guarded.update('@neo')).toThrow('closed')
    expect(effects).not.toHaveBeenCalled()
  })

  it('detaches extension graphs, preserves aliases, null prototypes, sparse arrays, and separate occurrences', () => {
    const seen: Array<Record<string, any>> = []
    const plugin = declare(builder => {
      builder.addInlineRule({ name: 'extended', triggerChars: [64], tokenize: src => {
        if (!src.startsWith('@neo')) return null
        const record = Object.assign(Object.create(null), { value: 'original', ['__proto__']: 'data' })
        const sparse = Array(3); sparse[1] = record
        return { raw: '@neo', token: { ...code().token, extension: { left: record, right: record, sparse } } as InlineToken }
      } })
      builder.setRenderer('codespan', token => {
        const value = token as unknown as Record<string, any>
        expect(value.extension.left).toBe(value.extension.right)
        expect(value.extension.sparse[1]).toBe(value.extension.left)
        expect(Object.getPrototypeOf(value.extension.left)).toBeNull()
        expect(value.extension.left.__proto__).toBe('data')
        expect(value.extension.sparse).toHaveLength(3)
        expect(0 in value.extension.sparse).toBe(false)
        expect(2 in value.extension.sparse).toBe(false)
        expect(value.extension.left.value).toBe('original')
        seen.push(value)
        value.extension.left.value = 'mutated'
        return '<code>original</code>'
      })
    })
    const session = createIncrementalMarkdown({ pluginReuse: 'declared', parser: { plugins: [plugin] } })
    for (let i = 0; i < 3; i++) expect(session.update('@neo\n\n@neo').html).toBe('<p><code>original</code></p>\n<p><code>original</code></p>\n')
    expect(new Set(seen.map(token => token.extension.left)).size).toBe(6)
    expect(session.metrics.reusedInlineCodeUnits).toBeGreaterThan(0)
  })

  it.each(['getter', 'frozen', 'sealed', 'hidden', 'function', 'prototype', 'cycle', 'symbol', 'bigint', 'deep', 'oversized', 'sparse'])('renders unsupported %s graphs uncached without retry or extra getter calls', kind => {
    const getter = vi.fn(() => 'extra')
    const tokenize = vi.fn((src: string) => {
      if (!src.startsWith('@neo')) return null
      const token = { ...code().token } as Record<string | symbol, any>
      if (kind === 'getter') Object.defineProperty(token, 'extension', { get: getter, enumerable: true })
      if (kind === 'frozen') Object.freeze(token)
      if (kind === 'sealed') Object.seal(token)
      if (kind === 'hidden') Object.defineProperty(token, 'hidden', { value: true })
      if (kind === 'function') token.extension = () => 'extra'
      if (kind === 'prototype') token.extension = new Date(0)
      if (kind === 'cycle') token.extension = token
      if (kind === 'symbol') token[Symbol('extra')] = true
      if (kind === 'bigint') token.extension = 1n
      if (kind === 'deep') { let extra = token; for (let i = 0; i < 260; i++) extra = extra.extension = {} }
      if (kind === 'oversized') token.extension = 'x'.repeat(100)
      if (kind === 'sparse') token.extension = Array(1000)
      return { raw: '@neo', token: token as InlineToken }
    })
    const session = createIncrementalMarkdown({ pluginReuse: 'declared', maxCachedTokens: kind === 'sparse' ? 100 : 50_000,
      maxCachedTokenCodeUnits: kind === 'oversized' ? 80 : 1_000_000, parser: { plugins: [declare(builder => builder.addInlineRule({ name: 'special', triggerChars: [64], tokenize }))] } })
    for (let i = 0; i < 2; i++) expect(session.update('@neo').html).toContain('<code>@neo</code>')
    expect(tokenize).toHaveBeenCalledTimes(2)
    expect(session.metrics.cacheEntries).toBe(0)
    expect(getter).not.toHaveBeenCalled()
  })

  it('charges snapshot work, preserves zero-capacity output, and rejects invalid normal token graphs', () => {
    const effects = vi.fn((html: string) => html)
    const plugin = declare(builder => {
      builder.addInlineRule({ name: 'custom', triggerChars: [64], tokenize: () => ({ raw: '@neo', token: { ...code().token, extra: 'x'.repeat(10_000) } as InlineToken }) })
      builder.addHtmlTransform(effects)
    })
    const bounded = createIncrementalMarkdown({ pluginReuse: 'declared', maxWorkCodeUnits: 1000, parser: { plugins: [plugin] } })
    expect(() => bounded.update('@neo')).toThrow('maxWorkCodeUnits')
    expect(effects).not.toHaveBeenCalled()
    expect(bounded.metrics.cacheEntries).toBe(0)
    const zero = createIncrementalMarkdown({ pluginReuse: 'declared', maxEntries: 0, maxCachedTokens: 0, parser: { plugins: [plugin] } })
    expect(zero.update('@neo')).toEqual(createParser({ plugins: [plugin] }).parseDocument('@neo'))
    const invalid = createIncrementalMarkdown({ pluginReuse: 'declared', parser: { plugins: [declare(builder => builder.addInlineRule({ name: 'invalid', tokenize: () => ({ raw: '@neo', token: { type: 'unknown' } as never }) }))] } })
    expect(() => invalid.update('@neo')).toThrow('Unknown inline token type')
    expect(invalid.metrics.cacheEntries).toBe(0)
  })

  it('rejects oversized snapshot capacity without charging for contents it never copies', () => {
    const plugin = declare(builder => builder.addInlineRule({ name: 'capacity', triggerChars: [64], tokenize: () => ({
      raw: '@neo', token: { ...code().token, extension: Array(1000) } as InlineToken,
    }) }))
    const session = createIncrementalMarkdown({ pluginReuse: 'declared', maxCachedTokens: 20, maxWorkCodeUnits: 200, parser: { plugins: [plugin] } })
    expect(session.update('@neo').html).toContain('<code>@neo</code>')
    expect(session.metrics.cacheEntries).toBe(0)
    expect(session.metrics.workCodeUnits).toBeLessThan(200)
  })

  it('preserves UGC validation for nested tokens synthesized by cached rules', () => {
    const plugin = declare(builder => builder.addInlineRule({ name: 'many', triggerChars: [64], tokenize: () => ({ raw: '@neo', token: {
      type: 'strong', raw: '@neo', tokens: Array.from({ length: 20_000 }, () => ({ type: 'text', raw: 'x', text: 'x' })),
    } }) }))
    const session = createIncrementalMarkdown({ pluginReuse: 'declared', maxCachedTokens: 300_000, maxWorkCodeUnits: 100_000_000,
      parser: { ugc: true, plugins: [plugin] } })
    session.update('@neo')
    expect(session.metrics.cacheEntries).toBe(1)
    expect(() => session.update('@neo\n\n@neo\n\n@neo')).toThrow(/token count/)
    expect(session.metrics.reusedInlineCodeUnits).toBeGreaterThan(0)
    expect(session.metrics.cacheEntries).toBe(0)
  })
})
