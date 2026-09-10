import { describe, expect, it, vi } from 'vitest'
import { createParser, parse } from '../../src/index.js'
import { highlightPlugin } from '../../src/plugins/highlight.js'

const grammar = { name: ' JavaScript ', aliases: [' JS '], tokens: {} }
const options = {
  grammars: [grammar],
  tokenize: (code: string) => [code],
  renderToHTML: (tokens: string[]) => `<pre>${tokens.join('')}</pre>`,
}

describe('highlight integration options', () => {
  it('normalizes names, aliases, and language hints', () => {
    const tokenize = vi.fn(options.tokenize)
    const parser = createParser({ plugins: [highlightPlugin({ ...options, tokenize })] })
    for (const lang of ['JS', 'javascript', 'JavaScript', 'js']) {
      expect(parser.parse('```' + lang + '\nconst x = 1\n```')).toContain('const x = 1')
    }
    expect(tokenize).toHaveBeenCalledTimes(4)
    expect(tokenize.mock.calls.every(([code]) => code === 'const x = 1\n')).toBe(true)
  })

  it('passes each resource limit to its corresponding stage', () => {
    const tokenize = vi.fn(options.tokenize)
    const renderToHTML = vi.fn(options.renderToHTML)
    const limits = {
      maxInputLength: 50, maxMatchCount: 10, maxTokenCount: 20,
      maxTokenDepth: 3, maxRenderedLength: 200, maxLines: 5,
    }
    parse('```JS\nconst x = 1\n```', {
      plugins: [highlightPlugin({ ...options, ...limits, tokenize, renderToHTML })],
    })
    expect(tokenize).toHaveBeenCalledWith('const x = 1\n', grammar, {
      maxInputLength: 50, maxMatchCount: 10, maxTokenCount: 20, maxTokenDepth: 3,
    })
    expect(renderToHTML).toHaveBeenCalledWith(['const x = 1\n'], expect.objectContaining({
      language: 'js', maxTokenCount: 20, maxTokenDepth: 3, maxRenderedLength: 200, maxLines: 5,
    }))
  })

  it('separates the language and line metadata at a tab', () => {
    const renderToHTML = vi.fn(options.renderToHTML)
    parse('```JS\t{2}\na\nb\n```', {
      plugins: [highlightPlugin({ ...options, renderToHTML })],
    })
    expect(renderToHTML).toHaveBeenCalledWith(['a\nb\n'], expect.objectContaining({
      language: 'js', highlightLines: [2],
    }))
  })

  it('selects diff lines for each block without changing fence metadata', () => {
    const renderToHTML = vi.fn(options.renderToHTML)
    const plugin = highlightPlugin({
      ...options, renderToHTML,
      diffHighlight: (token) => token.meta?.includes('added') ? { added: [1] } : { removed: [2] },
    })
    parse('```js {1} added\na\n```\n\n```js\nb\nc\n```', { plugins: [plugin] })
    expect(renderToHTML).toHaveBeenNthCalledWith(1, ['a\n'], expect.objectContaining({
      highlightLines: [1], diffHighlight: { added: [1] },
    }))
    expect(renderToHTML).toHaveBeenNthCalledWith(2, ['b\nc\n'], expect.objectContaining({
      diffHighlight: { removed: [2] },
    }))
  })

  it('counts CRLF and bare CR lines for caller-provided code tokens', () => {
    const renderToHTML = vi.fn(options.renderToHTML)
    const parser = createParser({ plugins: [highlightPlugin({ ...options, renderToHTML })] })
    parser.render([{ type: 'code', raw: '', text: 'a\r\nb\rc', lang: 'js', meta: '{1-3}' }])
    expect(renderToHTML).toHaveBeenCalledWith(['a\r\nb\rc'], expect.objectContaining({ highlightLines: [1, 2, 3] }))
  })

  it.each(['tokenize', 'render'] as const)('reports %s failures and preserves strict errors by default', (stage) => {
    const error = new Error('failed')
    const onError = vi.fn()
    const plugin = highlightPlugin({
      ...options, onError,
      ...(stage === 'tokenize' ? { tokenize: () => { throw error } } : { renderToHTML: () => { throw error } }),
    })
    expect(() => parse('```JS {1}\ncode\n```', { plugins: [plugin] })).toThrow(error)
    expect(onError).toHaveBeenCalledExactlyOnceWith(error, { stage, code: 'code\n', language: 'js', meta: '{1}' })
  })

  it('escapes failed blocks, renders later blocks, and resets cleanly for the next document', () => {
    const onError = vi.fn()
    const parser = createParser({ plugins: [highlightPlugin({
      ...options, errorPolicy: 'plain', onError,
      tokenize: (code) => {
        if (code.startsWith('<')) throw new RangeError('too large')
        return [code]
      },
    })] })
    const html = parser.parse('```JS\n<script>bad()</script>\n```\n\n# After\n\n```js\nok\n```')
    expect(html).toContain('<pre><code class="language-js">&lt;script&gt;bad()&lt;/script&gt;\n</code></pre>')
    expect(html).toContain('<h1>After</h1>')
    expect(html).toContain('<pre>ok\n</pre>')
    expect(onError).toHaveBeenCalledTimes(1)
    expect(parser.parse('```js\nnext\n```')).toBe('<pre>next\n</pre>\n')
    expect(onError).toHaveBeenCalledTimes(1)
  })

  it('does not suppress errors from the diagnostic callback', () => {
    const error = new Error('diagnostic failure')
    const plugin = highlightPlugin({
      ...options, errorPolicy: 'plain',
      tokenize: () => { throw new Error('tokenizer failure') },
      onError: () => { throw error },
    })
    expect(() => parse('```js\ncode\n```', { plugins: [plugin] })).toThrow(error)
  })

  it('omits theme styles without calling the stylesheet generator in external mode', () => {
    const getThemeStylesheet = vi.fn(() => '.token{color:red}')
    const parser = createParser({ plugins: [highlightPlugin({
      ...options, theme: { name: 'theme' }, getThemeStylesheet, injectStyles: false,
    })] })
    expect(parser.parse('```js\ncode\n```')).not.toContain('<style>')
    expect(getThemeStylesheet).not.toHaveBeenCalled()
  })

  it.each(['maxInputLength', 'maxMatchCount', 'maxTokenCount', 'maxTokenDepth', 'maxRenderedLength', 'maxLines'])(
    'rejects invalid %s configuration before fallback can suppress it', (name) => {
      for (const value of [-1, 1.5, NaN, -Infinity]) {
        expect(() => highlightPlugin({ ...options, errorPolicy: 'plain', [name]: value })).toThrow(name)
      }
      expect(() => highlightPlugin({ ...options, [name]: Infinity })).not.toThrow()
    }
  )

  it('rejects invalid prefixes even for empty registries', () => {
    expect(() => highlightPlugin({ ...options, grammars: [], classPrefix: 'x" onclick="bad()' })).toThrow('classPrefix')
  })
})

it('passes source line layout through global and per-block render options', () => {
  const renderToHTML = vi.fn(options.renderToHTML)
  const parser = createParser({ plugins: [highlightPlugin({ ...options, renderToHTML, wrapLines: 'source',
    renderOptions: context => context.metadata.attributes.filename ? { wrapLines: false } : undefined,
  })] })
  parser.parse('```js\na\n```\n\n```js filename="test.js"\nb\n```')
  expect(renderToHTML).toHaveBeenNthCalledWith(1, ['a\n'], expect.objectContaining({ wrapLines: 'source' }))
  expect(renderToHTML).toHaveBeenNthCalledWith(2, ['b\n'], expect.objectContaining({ wrapLines: false }))
})
