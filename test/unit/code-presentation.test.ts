import { describe, expect, it, vi } from 'vitest'
import { createParser, escapeHtml } from '../../src/index.js'
import { createParser as sanitizedParser } from '../../src/sanitized.js'
import { codePresentationPlugin, getCodePresentationStyles } from '../../src/plugins/code-presentation.js'
import type { CodePresentationOptions } from '../../src/plugins/code-presentation.js'
import type { CodeToken } from '../../src/core/types.js'

const fence = (source: string, meta = '', language = 'text') => '```' + language + ' ' + meta + '\n' + source + '\n```'
const render = (source: string, meta = '', options: CodePresentationOptions = {}) => createParser({ plugins: [codePresentationPlugin({ injectStyles: false, ...options })] }).parse(fence(source, meta))
const grammar = { name: 'javascript', aliases: ['js'], tokens: {} }

describe('code presentation', () => {
  it('renders escaped captions and filenames as text, with no generated IDs', () => {
    const html = render('x', 'title="A &amp; B" filename="src/<client>.ts"')
    expect(html).toContain('<figcaption class="neo-code-caption"><span class="neo-code-title">A &amp; B</span> — <span class="neo-code-filename">src/&lt;client&gt;.ts</span></figcaption>')
    expect(html).not.toMatch(/href=| id=|<client>/)
    expect(html).toContain('tabindex="0" role="region" aria-label="A &amp; B — src/&lt;client&gt;.ts"')
  })
  it('accepts caption as the preferred title alias and handles filename-only blocks', () => {
    expect(render('x', 'caption=Caption title=Title')).toContain('>Caption</span>')
    expect(render('x', 'filename=app.ts')).toContain('<span class="neo-code-filename">app.ts</span>')
    expect(render('x')).not.toContain('<figcaption')
  })
  it('keeps unknown metadata as data and does not interpret Markdown or HTML captions', () => {
    const html = render('<script>&', 'caption="**literal** <img src=x onerror=bad()>" __proto__=polluted')
    expect(html).toContain('**literal** &lt;img')
    expect(html).not.toMatch(/<img|<script|<strong|polluted/)
  })
  it('focuses bounded source positions while displaying an independent line offset', () => {
    const html = render('a\nb\nc', 'focus="2-9007199254740991" lines start=20 {1}')
    expect(html).toContain('neo-code-highlighted neo-code-dimmed" data-code-line="1"')
    expect(html).toContain('neo-code-focused" data-code-line="2"')
    expect(html).toContain('neo-code-focused" data-code-line="3"')
    expect(html).toContain('neo-code-dimmed" data-code-line="4"')
    expect(html).toContain('aria-hidden="true">20</span>')
    expect(html).toContain('aria-hidden="true">22</span>')
  })
  it('leaves code and comments intact without the diff flag', () => {
    const html = render('+ added\n- removed\n  indented\nconst x = "[!code ++]"')
    expect(html).toContain('>+ added</span>')
    expect(html).toContain('>- removed</span>')
    expect(html).toContain('>  indented</span>')
    expect(html).toContain('[!code ++]')
    expect(html).not.toContain('data-copy-code-exclude')
  })
  it('strips only explicit diff prefixes and supports metadata-only diff ranges', () => {
    const html = render('- old\n+ new\n  unchanged\n++keep\n-keep', 'diff added=3 removed=1 modified=5')
    expect(html).toContain('data-code-diff="removed" data-copy-code-exclude="true"')
    expect(html).toContain('role="group" aria-label="Removed line 1"')
    expect(html).toContain('>old</span>')
    expect(html).toContain('>new</span>')
    expect(html).toContain('>unchanged</span>')
    expect(html).toContain('>++keep</span>')
    expect(html).toContain('>-keep</span>')
    expect(html).toContain('data-code-diff="modified"')
    expect(html).toContain('neo-code-has-diff')
  })
  it('gives removals precedence over additions and modifications', () => {
    const html = render('x', 'added=1 removed=1 modified=1')
    expect(html).toContain('data-code-diff="removed"')
    expect(html).not.toContain('data-code-diff="added"')
    expect(html).not.toContain('data-code-diff="modified"')
  })
  it('supports explicit false flags and reports malformed fields without hiding source', () => {
    const onDiagnostic = vi.fn()
    const html = render('+ x', 'diff=false lines=false focus="1,no" start=1e3 caption filename', { lineNumbers: true, startLine: 5, onDiagnostic })
    expect(html).toContain('>+ x</span>')
    expect(html).not.toContain('neo-code-number')
    expect(html).not.toContain('neo-code-dimmed')
    expect(onDiagnostic.mock.calls[0][0].map((d: { field: string }) => d.field)).toEqual(['caption', 'filename', 'start', 'focus'])
    expect(Object.isFrozen(onDiagnostic.mock.calls[0][0][0])).toBe(true)
  })
  it.each(['focus="0"', 'focus="3-1"', 'focus="9007199254740992"', 'diff=maybe', 'lines=maybe', 'start=9007199254740992', 'start=9007199254740991', 'title="unfinished'])('reports invalid metadata: %s', meta => {
    const onDiagnostic = vi.fn()
    expect(render('a\nb', meta, { onDiagnostic })).toContain('>a</span>')
    expect(onDiagnostic).toHaveBeenCalledOnce()
  })
  it('does not dim any line when all focus positions are outside the source', () => {
    expect(render('a', 'focus=99')).not.toContain('neo-code-dimmed')
  })
  it('preserves caller tokens across repeated renders, nested code, and CRLF input', () => {
    const token: CodeToken = { type: 'code', raw: 'original', info: 'text diff', lang: 'text', meta: 'diff', text: '- old\r\n+ new\r\n\r\n  last\r' }
    const before = { ...token }
    const parser = createParser({ plugins: [codePresentationPlugin({ injectStyles: false })] })
    const html = parser.render([token])
    expect(parser.render([token])).toBe(html)
    expect(token).toEqual(before)
    expect(html).toContain('>last</span>')
    expect(parser.parse('> ```text title=Nested\n> code\n> ```')).toContain('>Nested</span>')
    expect(parser.parse('    indented')).toContain('>indented</span>')
  })
  it('keeps wrappers before sanitization and copy transforms, with keyboard access', () => {
    const parser = sanitizedParser({ allowHtml: true, sanitize: true, plugins: [codePresentationPlugin({ injectStyles: false })] })
    const html = parser.parse(fence('x', 'caption="<img src=x onerror=bad()>" focus=1'))
    expect(html).toContain('<figure')
    expect(html).toContain('<figcaption')
    expect(html).toContain('tabindex="0"')
    expect(html).toContain('data-code-line="1"')
    expect(html).not.toMatch(/<img|<style| style=/)
  })
  it('composes with block wrappers and remains stable during reentrant renders', () => {
    const parser = createParser({
      plugins: [codePresentationPlugin({ injectStyles: false })],
      renderCodeBlock: (context, next) => {
        if (context.source === 'outer\n') parser.parse(fence('inner', 'title=Inner'))
        return '<section>' + next() + '</section>'
      },
    })
    const html = parser.parse(fence('outer', 'title=Outer'))
    expect(html).toContain('<section><figure')
    expect(html).toContain('>Outer</span>')
    expect(html).not.toContain('Inner')
  })
  it('keeps sanitized code in the normal tab order without accepting arbitrary tab positions', () => {
    const parser = sanitizedParser({ allowHtml: true, sanitize: true })
    expect(parser.parse('<pre tabindex="9">x</pre>')).not.toContain('tabindex')
    expect(parser.parse('<pre tabindex="invalid">x</pre>')).not.toContain('tabindex')
    expect(parser.parse('<pre tabindex="0">x</pre>')).toContain('tabindex="0"')
    expect(parser.parse('<pre tabindex="-1">x</pre>')).toContain('tabindex="-1"')
  })
  it('exports CSS with visible focus and contrast preferences and supports custom prefixes', () => {
    const css = getCodePresentationStyles({ classPrefix: 'example' })
    expect(css).toContain('.example-source:focus-visible')
    expect(css).toContain('.example:focus-within .example-dimmed{opacity:1}')
    expect(css).toContain('@media(prefers-contrast:more)')
    expect(render('x', 'focus=1', { classPrefix: 'example' })).toContain('class="example"')
    expect(() => getCodePresentationStyles({ classPrefix: 'x}</style>' })).toThrow(TypeError)
  })
  it('injects one stylesheet per document without retaining parser state', () => {
    const parser = createParser({ plugins: [codePresentationPlugin()] })
    const source = fence('x') + '\n\n' + fence('y')
    expect(parser.parse(source).match(/<style>/g)).toHaveLength(1)
    expect(parser.parse(source)).toBe(parser.parse(source))
  })
  it.each(['maxInputLength', 'maxLines', 'maxRenderedLength'] as const)('enforces %s for decorated and unknown-language blocks', limit => {
    expect(() => render('hello', 'caption=test diff', { [limit]: 0 })).toThrow(limit)
    expect(() => codePresentationPlugin({ [limit]: -1 })).toThrow(limit)
  })
  it('bounds complete wrapper output and original input before prefix removal', () => {
    expect(() => render('+ x', 'diff caption="' + 'c'.repeat(1000) + '"', { maxRenderedLength: 500 })).toThrow('maxRenderedLength')
    expect(() => render('+ x', 'diff', { maxInputLength: 2 })).toThrow('maxInputLength')
    expect(() => render('a\nb', '', { startLine: Number.MAX_SAFE_INTEGER })).toThrow('safe integer')
    expect(() => codePresentationPlugin({ startLine: 0 })).toThrow('startLine')
  })
  it('passes cleaned source and metadata to the configured highlighter without changing caller tokens', () => {
    const tokenize = vi.fn((source: string) => [source])
    const renderToHTML = vi.fn((tokens: string[]) => '<pre><code>' + escapeHtml(tokens.join('')) + '</code></pre>')
    const configure = vi.fn(() => ({ lineNumbers: false }))
    const parser = createParser({ plugins: [codePresentationPlugin({ injectStyles: false, highlight: { grammars: [grammar], tokenize, renderToHTML, renderOptions: configure } })] })
    const token: CodeToken = { type: 'code', raw: 'original', lang: 'JS', meta: 'diff lines start=20 focus=2', text: '- old\r\n+ new\r\n' }
    parser.render([token])
    expect(token.text).toBe('- old\r\n+ new\r\n')
    expect(tokenize.mock.calls[0][0]).toBe('old\r\nnew\r\n')
    expect(configure.mock.calls[0][0]).toMatchObject({ source: 'old\r\nnew\r\n', resolvedLanguage: 'javascript' })
    expect(renderToHTML.mock.calls[0][1]).toMatchObject({ startLine: 20, lineNumbers: false, diffHighlight: { removed: [1], added: [2] } })
  })
  it('uses plain presentation when highlighting fails and preserves the original error stage', () => {
    const onError = vi.fn()
    const parser = createParser({ plugins: [codePresentationPlugin({ injectStyles: false, highlight: {
      grammars: [grammar], tokenize: () => { throw new Error('grammar failed') }, renderToHTML: () => '', errorPolicy: 'plain', onError,
    } })] })
    const html = parser.parse(fence('- <old>\n+ <new>', 'diff caption=Failure', 'js'))
    expect(html).toContain('>&lt;new&gt;</span>')
    expect(html).toContain('data-copy-code-exclude="true"')
    expect(onError.mock.calls[0][1].stage).toBe('tokenize')
  })
})
