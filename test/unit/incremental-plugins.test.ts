import { describe, it, expect, vi } from 'vitest'
import { createParser } from '../../src/index.js'
import { createIncrementalMarkdown, defineIncrementalPlugin } from '../../src/experimental/index.js'
import { isolateTokens } from '../../src/experimental/isolate-tokens.js'
import { tocPlugin } from '../../src/plugins/toc.js'
import { codePresentationPlugin } from '../../src/plugins/code-presentation.js'
import { copyCodePlugin } from '../../src/plugins/copy-code.js'
import { highlightPlugin } from '../../src/plugins/highlight.js'
import { embedPlugin } from '../../src/plugins/embeds.js'
import { sanitizeHtml } from '../../src/sanitizers/structural.js'
import type { MarkdownPlugin, PluginBuilder, BlockToken, ParserOptions, CodeBlockRenderHook } from '../../src/core/types.js'

const declared = (plugin: MarkdownPlugin, id = 'test:render') => defineIncrementalPlugin(plugin, { protocol: 1, profile: 'render', id })
const source = '# Same\n\n# Same\n\nrepeat **text**\n\nrepeat **text**\n\n- one\n- two\n\n```js caption=Example focus=bad\nconst value = 1;\n```\n\n[link][target]\n\n[target]: /one\n'

describe('incremental plugin declarations and registration checks', () => {
  it('requires explicit opt-in and reports immutable bounded policy independently from document diagnostics', () => {
    const plugin = declared(() => {})
    const off = createIncrementalMarkdown({ parser: { plugins: [plugin] } })
    expect(off.reuse).toEqual({ mode: 'fallback', truncated: false, blockers: [{ code: 'plugin-reuse-off' }] })
    off.update(source); off.update(source)
    expect(off.metrics.reusedBlocks).toBe(0)
    const builtin = createIncrementalMarkdown({ pluginReuse: 'declared' })
    expect(builtin.reuse.mode).toBe('built-in')
    builtin.update(source); builtin.update(source)
    expect(builtin.metrics.clonedTokenNodes).toBe(0)
    const enabled = createIncrementalMarkdown({ parser: { plugins: [plugin] }, pluginReuse: 'declared' })
    expect(enabled.reuse).toEqual({ mode: 'declared', truncated: false, blockers: [] })
    expect(Object.isFrozen(enabled.reuse)).toBe(true)
    expect(Object.isFrozen(enabled.reuse.blockers)).toBe(true)
    expect(() => createIncrementalMarkdown({ pluginReuse: true as never })).toThrow(TypeError)
  })

  it('copies contract data without mutating plugin functions or invoking accessors', () => {
    const original = vi.fn()
    const contract = { protocol: 1, id: 'kept', profile: 'render' } as const
    const wrapped = defineIncrementalPlugin(original, contract)
    Object.assign(contract, { id: 'changed', profile: 'inline' })
    expect(wrapped).not.toBe(original)
    expect(Reflect.ownKeys(original)).not.toContain('incremental')
    const session = createIncrementalMarkdown({ pluginReuse: 'declared', parser: { plugins: [wrapped, wrapped] } })
    expect(session.reuse.blockers[0]).toMatchObject({ code: 'duplicate-plugin-id', pluginId: 'kept' })
    expect(original).toHaveBeenCalledTimes(2)
    const read = vi.fn(() => 1)
    expect(() => defineIncrementalPlugin(original, { get protocol() { return read() }, id: 'x', profile: 'render' } as never)).toThrow('data properties')
    expect(read).not.toHaveBeenCalled()
  })

  it.each([null, {}, { protocol: 2, id: 'x', profile: 'render' }, { protocol: 1, id: '', profile: 'render' },
    { protocol: 1, id: 'x'.repeat(129), profile: 'render' }, { protocol: 1, id: 'x', profile: 'block' },
    { protocol: 1, id: 'x', profile: 'render', pure: true }, { protocol: 1, id: 'x', profile: 'inline', effects: 'allowed' },
    { protocol: 1, id: 'x', profile: 'inline', effects: 'none', dependencies: { kind: 'revision', read: 1 } },
  ])('rejects malformed declarations: %j', contract => {
    expect(() => defineIncrementalPlugin(() => {}, contract as never)).toThrow(TypeError)
  })

  it('preserves original plugin option values while sealing the declared setup list', () => {
    let options: Readonly<ParserOptions>
    const plugin = declared(builder => { options = builder.options })
    const session = createIncrementalMarkdown({ pluginReuse: 'declared', parser: { plugins: [plugin] } })
    expect(options!.plugins).toEqual([plugin])
    expect(Object.isFrozen(options!.plugins)).toBe(true)
    expect(session.reuse.mode).toBe('declared')
  })

  it.each(['off', 'declared'] as const)('preserves ordinary plugin-list identity in preflight fallback: %s', pluginReuse => {
    const extra = vi.fn()
    const plugins: MarkdownPlugin[] = [builder => {
      expect(builder.options.plugins).toBe(plugins)
      builder.options.plugins!.push(extra)
    }]
    const session = createIncrementalMarkdown({ pluginReuse, parser: { plugins } })
    expect(session.reuse.mode).toBe('fallback')
    expect(extra).toHaveBeenCalledTimes(1)
    expect(plugins).toHaveLength(2)
    session.update(source)
    session.dispose()
  })

  it('does not sample inline revisions when another plugin selects preflight fallback', () => {
    const read = vi.fn(() => { throw new Error('must not run') })
    for (const dependencies of [{ kind: 'revision' as const, read }, { kind: 'static' as const }]) {
      const plugin = defineIncrementalPlugin(builder => builder.addInlineRule({ name: 'state', tokenize: () => null }), {
        protocol: 1, id: 'inline', profile: 'inline', effects: 'none', dependencies,
      })
      const session = createIncrementalMarkdown({ pluginReuse: 'declared', parser: { plugins: [plugin, () => {}] } })
      session.update(source); session.update(source)
      expect(session.reuse.blockers[0].code).toBe('undeclared-plugin')
      expect(session.metrics.reusedInlineCodeUnits).toBe(0)
    }
    expect(read).not.toHaveBeenCalled()
  })

  it('prevents setup from appending unaudited plugins and isolates the caller list', () => {
    const extra = vi.fn()
    const plugins = [declared(builder => {
      expect(() => builder.options.plugins!.push(extra)).toThrow(TypeError)
    })]
    const session = createIncrementalMarkdown({ pluginReuse: 'declared', parser: { plugins } })
    plugins.push(extra)
    session.update(source)
    expect(session.reuse.mode).toBe('declared')
    expect(extra).not.toHaveBeenCalled()
    session.dispose()
  })

  it('propagates setup failure without retrying and closes a retained registration scope', () => {
    let retained: PluginBuilder
    const failure = new Error('setup failed')
    const setup = vi.fn((builder: PluginBuilder) => { retained = builder; throw failure })
    expect(() => createIncrementalMarkdown({ pluginReuse: 'declared', parser: { plugins: [declared(setup)] } })).toThrow(failure)
    expect(setup).toHaveBeenCalledTimes(1)
    expect(() => retained!.addHtmlTransform(html => html)).toThrow('registration is closed')
  })

  it('does not infer declarations from names or unofficial metadata', () => {
    const fake = Object.assign(() => {}, { pure: true, incremental: { protocol: 1, id: 'toc', profile: 'render' } })
    const session = createIncrementalMarkdown({ pluginReuse: 'declared', parser: { plugins: [declared(tocPlugin()), fake] } })
    expect(session.reuse.blockers[0]).toMatchObject({ code: 'undeclared-plugin', pluginIndex: 1 })
    session.update(source); session.update(source)
    expect(session.metrics.clonedTokenNodes).toBe(0)
    expect(session.metrics.blockCheckpoints).toBe(0)
  })

  it.each([
    ['custom-block-rules', (builder: PluginBuilder) => builder.addBlockRule({ name: 'custom', tokenize: () => null })],
    ['registration-mismatch', (builder: PluginBuilder) => builder.addInlineRule({ name: 'custom', tokenize: () => null })],
    ['custom-block-rules', embedPlugin()],
  ] as const)('checks actual registrations and falls back once: %s', (code, plugin) => {
    const setup = vi.fn(plugin)
    const session = createIncrementalMarkdown({ pluginReuse: 'declared', parser: { plugins: [declared(setup)] } })
    expect(session.reuse.blockers[0].code).toBe(code)
    const parser = createParser({ plugins: [plugin] })
    expect(session.update(source)).toEqual(parser.parseDocument(source))
    expect(session.update(source)).toEqual(parser.parseDocument(source))
    expect(setup).toHaveBeenCalledTimes(1)
    expect(session.metrics.cacheEntries).toBe(0)
  })

  it('keeps caller blocks and renderer overrides in fallback', () => {
    for (const options of [{ blocks: [] }, { renderer: {} }] satisfies ParserOptions[]) {
      const session = createIncrementalMarkdown({ pluginReuse: 'declared', parser: { ...options, plugins: [declared(() => {})] } })
      expect(session.reuse.mode).toBe('fallback')
      expect(session.update('text')).toEqual(createParser(options).parseDocument('text'))
    }
  })

  it('bounds declarations, registrations, and blocker records without truncating plugin execution', () => {
    const setup = vi.fn()
    const tooMany = Array.from({ length: 65 }, (_, i) => declared(setup, `id:${i}`))
    const count = createIncrementalMarkdown({ pluginReuse: 'declared', parser: { plugins: tooMany } })
    expect(count.reuse.blockers[0].code).toBe('contract-limit')
    expect(setup).toHaveBeenCalledTimes(65)
    const duplicate = declared(() => {})
    const many = createIncrementalMarkdown({ pluginReuse: 'declared', parser: { plugins: Array(64).fill(duplicate) } })
    expect(many.reuse.blockers).toHaveLength(16)
    expect(many.reuse.truncated).toBe(true)
    const calls = vi.fn((html: string) => html)
    const capacity = createIncrementalMarkdown({ pluginReuse: 'declared', parser: { plugins: [declared(builder => {
      for (let i = 0; i < 1025; i++) builder.addHtmlTransform(calls)
    })] } })
    expect(capacity.reuse.blockers[0].code).toBe('contract-limit')
    capacity.update('text')
    expect(calls).toHaveBeenCalledTimes(1025)
  })

  it('audits composed registrations and detects setup calls through an earlier retained builder', () => {
    let earlier: PluginBuilder
    const one = declared(builder => { earlier = builder }, 'one')
    const two = declared(() => earlier.addInlineRule({ name: 'late', tokenize: () => null }), 'two')
    const session = createIncrementalMarkdown({ pluginReuse: 'declared', parser: { plugins: [one, two] } })
    expect(session.reuse.blockers[0]).toMatchObject({ code: 'registration-mismatch', pluginId: 'one' })
    const nested = declared(builder => declared(embedPlugin(), 'inside')(builder))
    expect(createIncrementalMarkdown({ pluginReuse: 'declared', parser: { plugins: [nested] } }).reuse.mode).toBe('fallback')
  })
})

describe('render plugin token ownership and call behavior', () => {
  it('isolates duplicate inline occurrences, cached block tokens, and retained callback graphs', () => {
    const seen: BlockToken[][] = []
    const mutate = (capture = false): MarkdownPlugin => builder => builder.addTokenTransform(tokens => {
      if (capture) seen.push(tokens)
      for (const token of tokens) {
        if (token.type === 'code') token.text += '!'
        if (token.type === 'paragraph' && token.tokens[0]?.type === 'text') token.tokens[0].text += '!'
      }
      return tokens
    })
    const parser = createParser({ plugins: [mutate()] })
    const session = createIncrementalMarkdown({ pluginReuse: 'declared', parser: { plugins: [declared(mutate(true))] } })
    const text = 'repeat\n\nrepeat\n\n```js\nvalue\n```\n'
    const first = session.update(text), snapshot = JSON.stringify(first)
    const firstParagraphs = seen[0].filter(token => token.type === 'paragraph')
    expect(firstParagraphs[0].tokens).not.toBe(firstParagraphs[1].tokens)
    for (const next of [text, text + '\nnew\n', text, '- list\n\n' + text]) {
      // Caller-retained graphs can change after rendering without reaching private caches.
      for (const token of seen[0]) {
        if (token.type === 'code') token.text = 'CORRUPTED'
        if (token.type === 'paragraph') token.tokens.length = 0
      }
      expect(session.update(next)).toEqual(parser.parseDocument(next))
      expect(JSON.stringify(first)).toBe(snapshot)
    }
    expect(session.metrics.reusedBlocks).toBeGreaterThan(0)
    expect(session.metrics.reusedInlineCodeUnits).toBeGreaterThan(0)
    expect(session.metrics.clonedTokenNodes).toBeGreaterThan(0)
  })

  it('preserves complete results through 1000 edits with nested authoring blocks', { timeout: 15_000 }, () => {
    const make = () => [declared(tocPlugin(), 'toc'), declared(codePresentationPlugin(), 'presentation'), declared(copyCodePlugin(), 'copy')]
    const parser = createParser({ gfm: true, plugins: make() })
    const session = createIncrementalMarkdown({ pluginReuse: 'declared', maxWorkCodeUnits: 1_000_000_000, parser: { gfm: true, plugins: make() } })
    let text = source + '> - ```js\n' + '>   const value = 1;\n'.repeat(20)
    let seed = 0x914a
    const random = (max: number) => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) % max }
    const fragments = ['\n', '> ', '- ', '  ', '```\n', '**x**', '[target]: /two\n', '| a | b |\n| - | - |\n', '😀', '\r\n']
    for (let step = 0; step < 1000; step++) {
      const start = random(text.length + 1), end = Math.min(text.length, start + random(6))
      text = text.slice(0, start) + fragments[random(fragments.length)] + text.slice(end)
      expect(session.update(text), String(step)).toEqual(parser.parseDocument(text))
    }
    session.dispose()
  })

  it('preserves output and token ownership when retention limits discard entries', () => {
    const plugin = declared(builder => builder.addTokenTransform(tokens => {
      for (const token of tokens) if (token.type === 'code') token.text += '!'
      return tokens
    }))
    const options = { plugins: [plugin] }
    const parser = createParser(options)
    const session = createIncrementalMarkdown({ parser: options, pluginReuse: 'declared', maxCachedBlockTokens: 0, maxEntries: 0 })
    for (let i = 0; i < 3; i++) expect(session.update(source)).toEqual(parser.parseDocument(source))
    expect(session.metrics.blockCheckpoints).toBe(0)
    expect(session.metrics.cacheEntries).toBe(0)
  })

  it('preserves aliases within one private graph while detaching nested mutable values', () => {
    const shared = { text: 'value' }, input = { one: shared, two: shared, nested: [shared, { other: 'x' }] }
    const metrics = { clonedTokenNodes: 0, clonedTokenCodeUnits: 0 }
    const output = isolateTokens(input, () => {}, metrics)
    expect(output.one).toBe(output.two)
    expect(output.one).toBe(output.nested[0])
    expect(output.one).not.toBe(shared)
    output.one.text = 'changed'
    expect(input.one.text).toBe('value')
    expect(metrics.clonedTokenCodeUnits).toBe(6)
  })

  it('keeps renderer state, winning overrides, callbacks, sanitizer order, and document contributions current', () => {
    const build = (events: string[]) => {
      let count = 0
      const options = { allowHtml: true, sanitize: true, sanitizer: (html: string, config: Parameters<typeof sanitizeHtml>[1]) => { events.push('sanitize'); return sanitizeHtml(html, config) }, plugins: [
        declared(builder => builder.setRenderer('paragraph', () => { events.push('overridden'); return '' }), 'first'),
        declared(builder => {
          builder.addTokenTransform(tokens => { events.push('tokens'); return tokens })
          builder.setRenderer('paragraph', token => { events.push('render'); return `<p>${builder.renderInline(token.tokens)} ${++count}</p>\n` })
          builder.addHtmlTransform(html => { events.push('html'); builder.document?.reportDiagnostic({ source: 'test', code: 'count', severity: 'warning', message: String(count) }); return html })
        }, 'second'),
      ] }
      return options
    }
    const actual: string[] = [], expected: string[] = []
    const session = createIncrementalMarkdown({ parser: build(actual), pluginReuse: 'declared' })
    const parser = createParser(build(expected))
    for (const text of ['same', 'same', 'same\n\nnew']) expect(session.update(text)).toEqual(parser.parseDocument(text))
    expect(actual).toEqual(expected)
    expect(actual).not.toContain('overridden')
  })

  it.each([false, true])('composes TOC, presentation, copy-code and sanitization: %s', sanitize => {
    const make = () => {
      const toc = vi.fn(), diagnostics = vi.fn()
      const plugins = [declared(tocPlugin({ onToc: toc }), 'toc'), declared(codePresentationPlugin({ onDiagnostic: diagnostics }), 'presentation'), declared(copyCodePlugin(), 'copy')]
      return { toc, diagnostics, options: { gfm: true, allowHtml: true, sanitize, sanitizer: sanitizeHtml, plugins } }
    }
    const actual = make(), expected = make()
    const session = createIncrementalMarkdown({ pluginReuse: 'declared', parser: actual.options })
    const parser = createParser(expected.options)
    const first = session.update(source), snapshot = JSON.stringify(first)
    expect(first).toEqual(parser.parseDocument(source))
    for (const text of [source, source.replace('/one', '/two'), '# Earlier\n\n' + source, source.replace('caption=Example', 'caption=Other'), 'plain']) {
      expect(session.update(text)).toEqual(parser.parseDocument(text))
    }
    expect(actual.toc.mock.calls).toEqual(expected.toc.mock.calls)
    expect(actual.diagnostics.mock.calls).toEqual(expected.diagnostics.mock.calls)
    expect(JSON.stringify(first)).toBe(snapshot)
    expect(session.reuse.mode).toBe('declared')
    expect(session.metrics.reusedBlocks).toBeGreaterThan(0)
    expect(session.metrics.invalidatedInlineEntries).toBeGreaterThan(0)
  })

  it('reruns highlight callbacks and error handling on cache hits', () => {
    let fail = false
    const calls = vi.fn((code: string) => { if (fail) throw new Error('grammar failure'); return [{ content: code }] })
    const onError = vi.fn(), renderOptions = vi.fn()
    const plugin = highlightPlugin({ grammars: [{ name: 'js', tokens: {} }], tokenize: calls,
      renderToHTML: tokens => `<pre><code>${tokens[0].content}</code></pre>`, renderOptions, errorPolicy: 'plain', onError })
    const session = createIncrementalMarkdown({ pluginReuse: 'declared', parser: { plugins: [declared(plugin)] } })
    const text = '```js\ncode\n```'
    session.update(text); session.update(text); fail = true; session.update(text)
    expect(calls).toHaveBeenCalledTimes(3)
    expect(renderOptions).toHaveBeenCalledTimes(3)
    expect(onError).toHaveBeenCalledTimes(1)
    expect(session.metrics.reusedBlocks).toBeGreaterThan(0)
  })

  it('reruns parser and plugin code hooks with current nested source and document contributions', () => {
    const make = () => {
      const events: unknown[] = []
      const hook = (name: string): CodeBlockRenderHook => (context, next) => {
        events.push([name, context.token, context.source])
        return next()
      }
      return { events, options: {
        renderCodeBlock: hook('parser'), plugins: [declared(builder => {
          builder.addCodeBlockHook((context, next) => {
            builder.document!.reportDiagnostic({ source: 'hook', code: 'seen', message: context.source, severity: 'warning' })
            return hook('plugin')(context, next)
          })
          codePresentationPlugin()(builder)
        })],
      } }
    }
    const actual = make(), expected = make()
    const parser = createParser(expected.options)
    const session = createIncrementalMarkdown({ pluginReuse: 'declared', parser: actual.options })
    const nested = '> - ```js caption=Example\n' + '>   const x = 1;\n'.repeat(6)
    for (const input of [nested, nested, nested + '>   const y = 2;\n', '# Prefix\n\n' + nested]) {
      const result = session.update(input)
      expect(result).toEqual(parser.parseDocument(input))
      expect(result.diagnostics[0].codeBlock).toEqual({ index: 1, language: 'js' })
      expect(actual.events).toEqual(expected.events)
    }
    expect(session.metrics.continuationHits).toBeGreaterThan(0)
    expect(actual.events).toHaveLength(8)
    session.dispose()
  })
})

describe('declared session failure and lifecycle', () => {
  it.each(['outside', 'inside', 'caught'] as const)('rejects late registration with cleanup: %s', when => {
    let retained: PluginBuilder, late = false
    const session = createIncrementalMarkdown({ pluginReuse: 'declared', parser: { plugins: [declared(builder => {
      retained = builder
      builder.addHtmlTransform(html => {
        if (late) { if (when === 'caught') { try { builder.addHtmlTransform(value => value) } catch {} }
        else builder.addHtmlTransform(value => value) }
        return html
      })
    })] } })
    session.update(source)
    expect(session.metrics.blockCheckpoints).toBeGreaterThan(0)
    if (when === 'outside') expect(() => retained.addHtmlTransform(value => value)).toThrow('registration is closed')
    else { late = true; expect(() => session.update(source)).toThrow(/closed/) }
    expect(session.metrics.blockCheckpoints).toBe(0)
    expect(session.metrics.cacheEntries).toBe(0)
    expect(session.metrics.sourceLength).toBe(0)
    expect(() => session.update(source)).toThrow('closed')
  })

  it('preserves late registration behavior when capability checks select fallback', () => {
    let retained: PluginBuilder
    const session = createIncrementalMarkdown({ pluginReuse: 'declared', parser: { plugins: [declared(builder => {
      retained = builder
      builder.addInlineRule({ name: 'probe', tokenize: () => null })
    })] } })
    retained!.addHtmlTransform(html => html + 'late')
    expect(session.update('text').html).toBe('<p>text</p>\nlate')
  })

  it.each(['update', 'append', 'dispose'] as const)('closes on reentrant %s even if the callback swallows the error', operation => {
    let attempt = false
    const session = createIncrementalMarkdown({ pluginReuse: 'declared', parser: { plugins: [declared(builder => builder.addHtmlTransform(html => {
      if (attempt) { try { operation === 'dispose' ? session.dispose() : session[operation]('nested') } catch {} }
      return html
    }))] } })
    session.update(source); attempt = true
    expect(() => session.update(source)).toThrow('closed')
    expect(session.metrics.sourceLength).toBe(0)
    expect(session.metrics.cacheEntries).toBe(0)
  })

  it('isolates sessions and allows independent parser calls in callbacks', () => {
    const inner = createParser({ plugins: [tocPlugin()] })
    const plugin = declared(builder => builder.addHtmlTransform(html => inner.parseDocument('# Inner').html + html))
    const first = createIncrementalMarkdown({ pluginReuse: 'declared', parser: { plugins: [plugin] } })
    const second = createIncrementalMarkdown({ pluginReuse: 'declared', parser: { plugins: [plugin] } })
    first.update(source); first.update(source)
    expect(second.metrics.cacheEntries).toBe(0)
    expect(second.update(source)).toEqual(first.update(source))
    first.dispose(); expect(second.update(source).html).toContain('Inner')
  })

  it('charges cloning work before any render callback and closes on exhaustion', () => {
    const complete = createIncrementalMarkdown({ pluginReuse: 'declared', parser: { plugins: [declared(() => {})] } })
    complete.update(source)
    const limit = complete.metrics.workCodeUnits - 1
    const render = vi.fn((html: string) => html)
    const bounded = createIncrementalMarkdown({ pluginReuse: 'declared', maxWorkCodeUnits: limit,
      parser: { plugins: [declared(builder => builder.addHtmlTransform(render))] } })
    expect(() => bounded.update(source)).toThrow('maxWorkCodeUnits')
    expect(render).not.toHaveBeenCalled()
    expect(bounded.metrics.clonedTokenNodes).toBeGreaterThan(0)
    expect(bounded.metrics.sourceLength).toBe(0)
    expect(bounded.metrics.blockCheckpoints).toBe(0)
  })

  it('applies document limits on identical cached input and releases state without a retry', () => {
    const toc = vi.fn()
    const session = createIncrementalMarkdown({ pluginReuse: 'declared', parser: { plugins: [declared(tocPlugin({ onToc: toc }))] } })
    session.update(source)
    expect(() => session.update(source, { maxTocEntries: 0 })).toThrow('maxTocEntries')
    expect(toc).toHaveBeenCalledTimes(2)
    expect(session.metrics.cacheEntries).toBe(0)
  })

  it('preserves UGC budgets with repeated inline cache hits under a render plugin', () => {
    const session = createIncrementalMarkdown({ pluginReuse: 'declared', maxWorkCodeUnits: 100_000_000,
      parser: { ugc: true, plugins: [declared(() => {})] } })
    session.update('**text**')
    expect(() => session.update('**text**\n\n'.repeat(18_000))).toThrow(/token count/)
    expect(session.metrics.cacheEntries).toBe(0)
  })
})
