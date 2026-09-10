import { describe, expect, it } from 'vitest'
import { createIncrementalMarkdown, defineIncrementalPlugin, IncrementalMarkdownLimitError } from '../../src/experimental/index.js'

describe('session limit classification', () => {
  it.each([
    ['maxInputLength', 0], ['maxUpdates', 0], ['maxWorkCodeUnits', 0],
  ] as const)('classifies %s without changing RangeError compatibility', (limit, value) => {
    const session = createIncrementalMarkdown({ [limit]: value })
    let error: unknown
    try { session.update('x') } catch (caught) { error = caught }
    expect(error).toBeInstanceOf(RangeError)
    expect(error).toBeInstanceOf(IncrementalMarkdownLimitError)
    expect(error).toMatchObject({ limit, message: `Incremental Markdown exceeds ${limit}` })
    expect(session.metrics.sourceLength).toBe(0)
    expect(session.metrics.cacheEntries).toBe(0)
    expect(() => session.update('')).toThrow('closed')
  })

  it('classifies append overflow and releases existing state', () => {
    const session = createIncrementalMarkdown({ maxInputLength: 3 })
    session.append('abc')
    expect(() => session.append('d')).toThrow(IncrementalMarkdownLimitError)
    expect(session.metrics.sourceLength).toBe(0)
    expect(session.metrics.blockCheckpoints).toBe(0)
  })

  it('leaves unrelated parser and callback errors unchanged', () => {
    const error = new RangeError('Incremental Markdown exceeds maxWorkCodeUnits')
    const session = createIncrementalMarkdown({ parser: { plugins: [builder => builder.addHtmlTransform(() => { throw error })] } })
    expect(() => session.update('text')).toThrow(error)
    expect(error).not.toBeInstanceOf(IncrementalMarkdownLimitError)
    const parserLimited = createIncrementalMarkdown({ parser: { maxInputLength: 0 } })
    try { parserLimited.update('x'); expect.fail('expected parser limit') }
    catch (caught) { expect(caught).toBeInstanceOf(RangeError); expect(caught).not.toBeInstanceOf(IncrementalMarkdownLimitError) }
  })

  it('can exhaust work after an inline callback, without repeating that callback', () => {
    let calls = 0
    const plugin = defineIncrementalPlugin(builder => builder.addInlineRule({
      name: 'large', triggerChars: [64], tokenize: source => {
        if (!source.startsWith('@')) return null
        calls++
        return { raw: '@', token: { type: 'code', raw: '@', text: 'x'.repeat(2_000) } }
      },
    }), { protocol: 1, id: 'large', profile: 'inline', effects: 'none', dependencies: { kind: 'static' } })
    const session = createIncrementalMarkdown({ maxWorkCodeUnits: 1_000, pluginReuse: 'declared', parser: { plugins: [plugin] } })
    expect(() => session.update('@')).toThrow(IncrementalMarkdownLimitError)
    expect(calls).toBe(1)
    expect(session.metrics.cachedTokens).toBe(0)
    expect(() => session.append('')).toThrow('closed')
  })
})
