import { describe, expect, it, vi } from 'vitest'
import { createParser, createCodeBlockContext, getCodeBlockMetadata, parseCodeMetadata, escapeHtml, MAX_CODE_META_ENTRIES, MAX_CODE_META_LENGTH } from '../../src/index.js'
import { createParser as sanitizedParser } from '../../src/sanitized.js'
import type { CodeBlockContext, CodeBlockRenderHook, CodeToken, MarkdownPlugin } from '../../src/index.js'
import { highlightPlugin } from '../../src/plugins/highlight.js'

const fence = (meta = '', language = 'JS', code = 'const x = 1\n') => '```' + language + (meta ? ' ' + meta : '') + '\n' + code + '```'
const grammar = { name: 'javascript', aliases: ['js'], tokens: {} }
const highlighter = (renderOptions?: Parameters<typeof highlightPlugin<typeof grammar, string>>[0]['renderOptions']) => highlightPlugin({
  grammars: [grammar], tokenize: code => [code], renderToHTML: tokens => '<pre><code class="highlight">' + escapeHtml(tokens.join('')) + '</code></pre>', renderOptions,
})

describe('code metadata', () => {
  it('parses flags, quoted values, entities, escaped quotes, and bounded ranges', () => {
    const meta = parseCodeMetadata('title="a &amp; b" filename=src/app.ts lines note=\'it\\\'s ok\' {1,3-999999999}', 5)
    expect({ ...meta.attributes }).toEqual({ title: 'a & b', filename: 'src/app.ts', lines: true, note: "it's ok" })
    expect(meta.highlightLines).toEqual([1, 3, 4, 5])
    expect(meta.diagnostics).toEqual([])
  })
  it('does not interpret ranges in quoted or unquoted attribute values', () => {
    expect(parseCodeMetadata('title="{1}" pattern={2} {3}').highlightLines).toEqual([3])
  })
  it('retains unknown attributes and avoids prototype pollution', () => {
    const meta = parseCodeMetadata('__proto__=safe constructor=ok custom-flag title=first title=last')
    expect(Object.getPrototypeOf(meta.attributes)).toBeNull()
    expect(meta.attributes['__proto__']).toBe('safe')
    expect(meta.attributes['title']).toBe('last')
    expect(meta.diagnostics[0].code).toBe('duplicate-key')
  })
  it.each(['title="unfinished', 'title="ok"suffix', '=bad', 'title=', '{1-', '{text}', '{0,-1,5-2}', '{9007199254740992}'])('reports malformed metadata: %s', meta => {
    const result = parseCodeMetadata(meta)
    expect(result.diagnostics.length).toBeGreaterThan(0)
    expect(result.diagnostics.every(d => d.start >= 0 && d.end <= meta.length)).toBe(true)
  })
  it('retains empty values and does not treat string false as a flag', () => {
    expect({ ...parseCodeMetadata('title="" lines=false').attributes }).toEqual({ title: '', lines: 'false' })
  })
  it('bounds entry count, length, range expansion, and diagnostic growth', () => {
    expect(Object.keys(parseCodeMetadata('flag '.repeat(100_000)).attributes)).toEqual(['flag'])
    expect(parseCodeMetadata('flag '.repeat(100_000)).diagnostics.length).toBeLessThanOrEqual(MAX_CODE_META_ENTRIES + 1)
    const limited = parseCodeMetadata('title="' + 'x'.repeat(MAX_CODE_META_LENGTH))
    expect(limited.attributes['title']).toBeUndefined()
    expect(limited.diagnostics.some(d => d.code === 'limit-exceeded')).toBe(true)
    expect(parseCodeMetadata('{1-999999999}').highlightLines).toHaveLength(10_000)
    expect(parseCodeMetadata('{1-3}', 0).highlightLines).toEqual([])
  })
  it('exposes immutable snapshots without changing the token', () => {
    const token: CodeToken = { type: 'code', raw: '', lang: ' JS ', meta: 'title="first" {1-9}', info: ' JS  title="first" {1-9} ', text: 'a\r\nb\r' }
    const context = createCodeBlockContext(token)
    token.text = 'changed'; token.meta = 'title=changed'
    expect(context.source).toBe('a\r\nb\r')
    expect(context.language).toBe('js')
    expect(context.rawLanguage).toBe(' JS ')
    expect(context.rawInfo).toBe(' JS  title="first" {1-9} ')
    expect(context.lineCount).toBe(2)
    expect(getCodeBlockMetadata(context).highlightLines).toEqual([1, 2])
    expect(getCodeBlockMetadata(context)).toBe(getCodeBlockMetadata(context))
    expect(Object.isFrozen(context)).toBe(true)
    expect(Object.isFrozen(context.token)).toBe(true)
    expect(Object.isFrozen(getCodeBlockMetadata(context).attributes)).toBe(true)
    expect(Object.isFrozen(getCodeBlockMetadata(context).highlightLines)).toBe(true)
    expect(() => { (getCodeBlockMetadata(context).attributes as Record<string, string>)['title'] = 'bad' }).toThrow()
  })
  it.each([['', 0], ['a', 1], ['\n', 1], ['a\r\nb', 2], ['a\n\n', 2]] as const)('counts physical lines in %j', (source, count) => {
    expect(createCodeBlockContext({ type: 'code', raw: '', text: source }).lineCount).toBe(count)
  })
})

describe('code block rendering hooks', () => {
  it('preserves the exact fence info while keeping existing lang and meta fields', () => {
    const tokens = createParser().tokenize('```  JS\t title="test"  \nx\n```')
    expect(tokens[0]).toMatchObject({ lang: 'JS', meta: 'title="test"', info: '  JS\t title="test"  ', text: 'x\n' })
  })
  it('composes parser and plugin hooks around the final highlighted renderer', () => {
    const calls: string[] = []; const contexts: CodeBlockContext[] = []
    const renderFn = vi.fn((token: CodeToken) => '<pre>' + escapeHtml(token.text) + '</pre>')
    const hook = (name: string): CodeBlockRenderHook => (context, next) => {
      contexts.push(context); calls.push(name + ':before'); const html = next(); expect(next()).toBe(html); calls.push(name + ':after'); return '<div>' + html + '</div>'
    }
    const plugin: MarkdownPlugin = b => { b.addCodeBlockHook(hook('one')); b.setRenderer('code', renderFn); b.addCodeBlockHook(hook('two')) }
    createParser({ renderCodeBlock: hook('parser'), plugins: [plugin] }).parse(fence())
    expect(calls).toEqual(['parser:before', 'one:before', 'two:before', 'two:after', 'one:after', 'parser:after'])
    expect(renderFn).toHaveBeenCalledTimes(1)
    expect(contexts.every(context => context === contexts[0])).toBe(true)
    expect(renderFn.mock.calls[0][1]).toBe(contexts[0])
  })
  it.each([true, false])('does not depend on highlight plugin registration order: %s', first => {
    const wrapper: MarkdownPlugin = b => b.addCodeBlockHook((ctx, render) => '<figure><figcaption>' + escapeHtml(String(getCodeBlockMetadata(ctx).attributes['title'])) + '</figcaption>' + render() + '</figure>')
    const plugins = first ? [wrapper, highlighter()] : [highlighter(), wrapper]
    const html = createParser({ plugins }).parse(fence('title="<&>"'))
    expect(html).toContain('<figure><figcaption>&lt;&amp;&gt;</figcaption><pre><code class="highlight">')
  })
  it('runs on unknown, indented, nested, and caller-provided code blocks', () => {
    const seen: CodeBlockContext[] = []
    const parser = createParser({ renderCodeBlock: (ctx, next) => { seen.push(ctx); return next() }, plugins: [highlighter()] })
    parser.parse('> ```unknown title=test\n> x\n> ```\n\n    indented\n')
    parser.render([{ type: 'code', raw: '', text: 'manual' }])
    expect(seen.map(c => c.source)).toEqual(['x\n', 'indented\n', 'manual'])
    expect(getCodeBlockMetadata(seen[0]).attributes['title']).toBe('test')
    expect(seen[1].rawInfo).toBeUndefined()
  })
  it('keeps hooks before sanitization and escapes metadata as data', () => {
    const parser = sanitizedParser({ allowHtml: true, sanitize: true, renderCodeBlock: (ctx, next) => '<figure><figcaption>' + escapeHtml(String(getCodeBlockMetadata(ctx).attributes['title'])) + '</figcaption><script>bad()</script>' + next() + '</figure>' })
    const html = parser.parse(fence('title="<img src=x onerror=bad()>"'))
    expect(html).toContain('&lt;img')
    expect(html).not.toMatch(/<script|<img/)
  })
  it('propagates hook errors and rejects asynchronous HTML', () => {
    const failure = new Error('hook failure')
    expect(() => createParser({ renderCodeBlock: () => { throw failure } }).parse(fence())).toThrow(failure)
    expect(() => createParser({ renderCodeBlock: (() => Promise.resolve('bad')) as unknown as CodeBlockRenderHook }).parse(fence())).toThrow('synchronously')
  })
  it('does not retain context across documents or reentrant renders', () => {
    const seen: CodeBlockContext[] = []
    const parser = createParser({ renderCodeBlock: (ctx, next) => { seen.push(ctx); if (ctx.source === 'outer\n') parser.parse(fence('', 'js', 'inner\n')); return next() } })
    parser.parse(fence('', 'js', 'outer\n')); parser.parse(fence('', 'js', 'last\n'))
    expect(seen.map(c => c.source)).toEqual(['outer\n', 'inner\n', 'last\n'])
    expect(new Set(seen).size).toBe(3)
  })
  it('passes parsed metadata and canonical grammar selection to per-block options', () => {
    const render = vi.fn(() => '<pre/>'); const contexts: CodeBlockContext[] = []
    const parser = createParser({ renderCodeBlock: (ctx, next) => { contexts.push(ctx); return next() }, plugins: [highlightPlugin({
      grammars: [grammar], tokenize: code => [code], renderToHTML: render, maxLines: 10,
      renderOptions: context => {
        expect(context.resolvedLanguage).toBe('javascript'); expect(context.grammar).toBe(grammar)
        expect(context.metadata).toBe(getCodeBlockMetadata(contexts.at(-1)!))
        return { lineNumbers: true, startLine: Number(getCodeBlockMetadata(context).attributes['start']), highlightLines: [], maxLines: Infinity } as never
      },
    })] })
    parser.parse(fence('start=42 {1}'))
    expect(render.mock.calls[0][1]).toMatchObject({ language: 'js', startLine: 42, lineNumbers: true, highlightLines: [], maxLines: 10 })
  })
  it('reports configuration failures and uses escaped recovery', () => {
    const onError = vi.fn(); const tokenize = vi.fn(() => [])
    const parser = createParser({ plugins: [highlightPlugin({ grammars: [grammar], tokenize, renderToHTML: () => '', renderOptions: () => { throw new Error('bad metadata') }, onError, errorPolicy: 'plain' })] })
    expect(parser.parse(fence('', 'js', '<script>\n'))).toContain('&lt;script&gt;')
    expect(onError.mock.calls[0][1].stage).toBe('configure'); expect(tokenize).not.toHaveBeenCalled()
  })
})
