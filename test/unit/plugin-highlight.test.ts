/**
 * Highlight plugin tests
 *
 * Tests parseHighlightLines and the plugin's rendering with mock tokenize/renderToHTML.
 */

import { describe, it, expect } from 'vitest'
import { parse, createParser } from '../../src/index.js'
import { highlightPlugin, MAX_HIGHLIGHT_LINES, parseHighlightLines } from '../../src/plugins/highlight.js'
import type { CodeToken } from '../../src/core/types.js'

// Mock tokenize/renderToHTML for testing without neo.highlight installed
const mockTokenize = (code: string) => [code]
const mockRenderToHTML = (tokens: unknown[], opts: Record<string, unknown>) => {
  const lang = opts['language'] ?? ''
  const text = tokens.join('')
  return `<pre class="neo-hl" data-language="${lang}"><code>${text}</code></pre>`
}

// ---------------------------------------------------------------------------
// parseHighlightLines
// ---------------------------------------------------------------------------

describe('parseHighlightLines', () => {
  it('should parse single line number', () => {
    expect(parseHighlightLines('{1}')).toEqual([1])
  })

  it('should parse multiple line numbers', () => {
    expect(parseHighlightLines('{1,3,5}')).toEqual([1, 3, 5])
  })

  it('should parse line ranges', () => {
    expect(parseHighlightLines('{1-3}')).toEqual([1, 2, 3])
  })

  it('should parse mixed numbers and ranges', () => {
    expect(parseHighlightLines('{1,3-5,7}')).toEqual([1, 3, 4, 5, 7])
  })

  it('should handle spaces in range', () => {
    expect(parseHighlightLines('{1, 3-5, 7}')).toEqual([1, 3, 4, 5, 7])
  })

  it('should return undefined for no meta', () => {
    expect(parseHighlightLines(undefined)).toBeUndefined()
  })

  it('should return undefined for meta without braces', () => {
    expect(parseHighlightLines('title="test"')).toBeUndefined()
  })

  it('should return undefined for empty braces', () => {
    expect(parseHighlightLines('{}')).toBeUndefined()
  })

  it('should extract from meta with other attributes', () => {
    expect(parseHighlightLines('{1,3} title="example.ts"')).toEqual([1, 3])
  })

  it('should cap very large ranges', () => {
    const lines = parseHighlightLines('{1-100000000}')
    expect(lines).toHaveLength(MAX_HIGHLIGHT_LINES)
    expect(lines?.[0]).toBe(1)
    expect(lines?.at(-1)).toBe(MAX_HIGHLIGHT_LINES)
  })

  it('should safely ignore integers outside the safe range', () => {
    const hugeEndpoint = '9'.repeat(500)
    expect(parseHighlightLines(`{1-${hugeEndpoint}}`)).toBeUndefined()
  })

  it('should ignore zero, negative, and reversed ranges', () => {
    expect(parseHighlightLines('{0,-1,5-3}')).toBeUndefined()
  })

  it('should clamp ranges to an explicit line count', () => {
    expect(parseHighlightLines('{1-100000000}', 3)).toEqual([1, 2, 3])
  })
})

// ---------------------------------------------------------------------------
// Highlight Plugin
// ---------------------------------------------------------------------------

describe('highlightPlugin', () => {
  it('should fall back to default rendering when no grammar matches', () => {
    const plugin = highlightPlugin({
      grammars: [{ name: 'javascript', aliases: ['js'], tokens: {} }],
      tokenize: mockTokenize,
      renderToHTML: mockRenderToHTML,
    })

    // python is not registered
    const result = parse('```python\nprint("hi")\n```', { plugins: [plugin] })
    expect(result).toContain('<pre><code class="language-python">')
    expect(result).toContain('print(&quot;hi&quot;)')
  })

  it('should fall back to default rendering for code blocks without lang', () => {
    const plugin = highlightPlugin({
      grammars: [{ name: 'javascript', aliases: ['js'], tokens: {} }],
      tokenize: mockTokenize,
      renderToHTML: mockRenderToHTML,
    })

    const result = parse('```\nfoo()\n```', { plugins: [plugin] })
    expect(result).toContain('<pre><code>')
    expect(result).toContain('foo()')
  })

  it('should use tokenize and renderToHTML for known grammars', () => {
    const plugin = highlightPlugin({
      grammars: [{ name: 'javascript', aliases: ['js'], tokens: {} }],
      tokenize: mockTokenize,
      renderToHTML: mockRenderToHTML,
    })

    const result = parse('```js\nconst x = 1\n```', { plugins: [plugin] })
    expect(result).toContain('class="neo-hl"')
    expect(result).toContain('data-language="js"')
    expect(result).toContain('const x = 1')
  })

  it('should register grammar aliases', () => {
    const plugin = highlightPlugin({
      grammars: [{ name: 'javascript', aliases: ['js', 'mjs'], tokens: {} }],
      tokenize: mockTokenize,
      renderToHTML: mockRenderToHTML,
    })

    // 'mjs' alias resolves to javascript grammar
    const result = parse('```mjs\nexport default 1\n```', { plugins: [plugin] })
    expect(result).toContain('class="neo-hl"')
    expect(result).toContain('data-language="mjs"')
  })

  it('should pass theme and options to renderToHTML', () => {
    let receivedOpts: Record<string, unknown> = {}
    const spyRender = (tokens: unknown[], opts: Record<string, unknown>) => {
      receivedOpts = opts
      return '<pre>highlighted</pre>'
    }

    const plugin = highlightPlugin({
      grammars: [{ name: 'javascript', tokens: {} }],
      tokenize: mockTokenize,
      renderToHTML: spyRender,
      theme: { name: 'test-theme' },
      lineNumbers: true,
      classPrefix: 'hl',
    })

    parse('```javascript\ncode\n```', { plugins: [plugin] })
    expect(receivedOpts['theme']).toEqual({ name: 'test-theme' })
    expect(receivedOpts['lineNumbers']).toBe(true)
    expect(receivedOpts['classPrefix']).toBe('hl')
    expect(receivedOpts['language']).toBe('javascript')
  })

  it('should pass highlight lines from meta to renderToHTML', () => {
    let receivedOpts: Record<string, unknown> = {}
    const spyRender = (tokens: unknown[], opts: Record<string, unknown>) => {
      receivedOpts = opts
      return '<pre>highlighted</pre>'
    }

    const plugin = highlightPlugin({
      grammars: [{ name: 'typescript', aliases: ['ts'], tokens: {} }],
      tokenize: mockTokenize,
      renderToHTML: spyRender,
    })

    parse('```ts {1,3-5}\none\ntwo\nthree\nfour\nfive\n```', { plugins: [plugin] })
    expect(receivedOpts['highlightLines']).toEqual([1, 3, 4, 5])
  })

  it('should clamp highlight metadata to the code block line count', () => {
    let receivedOpts: Record<string, unknown> = {}
    const plugin = highlightPlugin({
      grammars: [{ name: 'typescript', aliases: ['ts'], tokens: {} }],
      tokenize: mockTokenize,
      renderToHTML: (_tokens, opts) => {
        receivedOpts = opts ?? {}
        return '<pre>highlighted</pre>'
      },
    })

    parse('```ts {1-100000000}\none\ntwo\nthree\n```', { plugins: [plugin] })
    expect(receivedOpts['highlightLines']).toEqual([1, 2, 3])
  })

  it('should preserve meta in code token for rendering', () => {
    const parser = createParser()
    const tokens = parser.tokenize('```ts {1,3} title="test"\ncode\n```')
    const code = tokens[0] as CodeToken
    expect(code.lang).toBe('ts')
    expect(code.meta).toBe('{1,3} title="test"')
  })

  it('should include theme styles in every document when a parser is reused', () => {
    const plugin = highlightPlugin({
      grammars: [],
      tokenize: mockTokenize,
      renderToHTML: mockRenderToHTML,
      theme: { name: 'test' },
      getThemeStylesheet: () => '.token{color:red}',
    })
    const parser = createParser({ plugins: [plugin] })

    expect(parser.parse('# One')).toContain('<style>.token{color:red}</style>')
    expect(parser.parse('# Two')).toContain('<style>.token{color:red}</style>')
  })
})
