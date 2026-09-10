import { describe, expect, it, vi } from 'vitest'
import { createParser } from '../../src/index.js'
import { createParser as sanitizedParser } from '../../src/sanitized.js'
import { codePresentationPlugin } from '../../src/plugins/code-presentation.js'
import { parseCodeWordRanges } from '../../src/plugins/code-word-ranges.js'

const fence = (code: string, meta: string) => '```text ' + meta + '\n' + code + '\n```'
describe('presentation word ranges', () => {
  it('maps one-based Unicode code-point columns to exclusive UTF-16 offsets', () => {
    expect(parseCodeWordRanges('😀 café\r\ne\u0301 end\n', '1:1-1:2, 1:3-2:3')).toEqual({ ranges: [{ start: 0, end: 2 }, { start: 3, end: 11 }] })
  })
  it('merges duplicates and overlaps while retaining gaps and empty lines', () => {
    expect(parseCodeWordRanges('abc\n\ndef', '1:2-3:2,1:1-1:3,3:2-3:4').ranges).toEqual([{ start: 0, end: 8 }])
    expect(parseCodeWordRanges('abc', undefined).ranges).toEqual([])
  })
  it.each(['1:0-1:2', '0:1-1:2', '1:2-1:2', '1:3-1:2', '2:1-2:2', '1:1-1:99', '1:1-1:9007199254740992', '1:1-1:2,bad', '1:1-1:2<script>', '', true])('rejects an invalid complete mark selection: %j', value => {
    const result = parseCodeWordRanges('abc', value)
    expect(result.ranges).toEqual([])
    expect(result.error).toBeTypeOf('string')
  })
  it('bounds metadata and range counts before source scanning', () => {
    expect(parseCodeWordRanges('abc', Array(257).fill('1:1-1:2').join(',')).error).toContain('256')
    expect(parseCodeWordRanges('abc', '1'.repeat(16_385)).error).toBeTruthy()
  })
  it('selects displayed source after diff prefixes and preserves caller tokens', () => {
    const parser = createParser({ plugins: [codePresentationPlugin({ injectStyles: false })] })
    const token = { type: 'code' as const, raw: '', lang: 'text', text: '- old\r\n+ 😀 new\r\n  last\n', meta: 'diff focus=2 lines start=20 mark="2:1-2:2,2:3-3:3"' }
    const original = { ...token }
    const html = parser.render([token])
    expect(html).toContain('<span class="neo-code-word-highlight">😀</span>')
    expect(html).toContain('<span class="neo-code-word-highlight">new</span>')
    expect(html).toContain('<span class="neo-code-word-highlight">la</span>st')
    expect(html).toContain('data-copy-code-exclude="true"')
    expect(token).toEqual(original)
    expect(parser.render([token])).toBe(html)
  })
  it('preserves source on malformed input and reports one field diagnostic', () => {
    const onDiagnostic = vi.fn()
    const parser = createParser({ plugins: [codePresentationPlugin({ injectStyles: false, onDiagnostic })] })
    const html = parser.parse(fence('<&>', 'mark="1:1-2:4"'))
    expect(html).toContain('&lt;&amp;&gt;')
    expect(html).not.toContain('class="neo-code-word-highlight"')
    expect(onDiagnostic.mock.calls[0][0]).toMatchObject([{ field: 'mark' }])
  })
  it('keeps word spans through sanitization without turning selected source into markup', () => {
    const parser = sanitizedParser({ allowHtml: true, sanitize: true, plugins: [codePresentationPlugin({ injectStyles: false })] })
    const html = parser.parse(fence('<img onerror=bad()>', 'mark="1:1-1:20"'))
    expect(html).toContain('<span class="neo-code-word-highlight">&lt;img onerror=bad()&gt;</span>')
    expect(html).not.toContain('<img')
  })
  it('excludes ranges from gutters and handles terminator-only selections', () => {
    const parser = createParser({ plugins: [codePresentationPlugin({ injectStyles: false })] })
    const html = parser.parse(fence('abc\ndef', 'lines start=50 mark="1:4-2:1"'))
    expect(html).not.toContain('class="neo-code-word-highlight"')
    expect(html).toContain('aria-hidden="true">50</span>')
  })
})
