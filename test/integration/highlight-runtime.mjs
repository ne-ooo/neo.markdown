import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { after, test } from 'node:test'
import { JSDOM } from 'jsdom'

const require = createRequire(import.meta.url)
const load = name => process.env.NEO_INTEGRATION_FORMAT === 'cjs' ? require(name) : import(name)
const markdown = await load('@lpm.dev/neo.markdown')
const sanitized = await load('@lpm.dev/neo.markdown/sanitized')
const { highlightPlugin } = await load('@lpm.dev/neo.markdown/plugins/highlight')
const { codePresentationPlugin, getCodePresentationStyles } = await load('@lpm.dev/neo.markdown/plugins/code-presentation')
const { copyCodePlugin, initializeCopyCode } = await load('@lpm.dev/neo.markdown/plugins/copy-code')
const { tocPlugin } = await load('@lpm.dev/neo.markdown/plugins/toc')
const highlight = await load('@lpm.dev/neo.highlight')
const { javascript } = await load('@lpm.dev/neo.highlight/grammars/javascript')
const { githubDark } = await load('@lpm.dev/neo.highlight/themes/github-dark')
const { handleHighlightWorkerRequest } = await load('@lpm.dev/neo.highlight/worker')
const incrementalHighlight = await load('@lpm.dev/neo.highlight/experimental')
const { createIncrementalMarkdown, defineIncrementalPlugin } = await load('@lpm.dev/neo.markdown/experimental')
// Finish asynchronous module loading before registering tests and teardown.
// Node 18 can finish a test batch while a later top-level import is pending.
const expandedGrammars = new Map(await Promise.all(['javascript', 'typescript', 'tsx', 'python', 'css', 'html', 'vue', 'svelte'].map(async language => {
  const module = await load('@lpm.dev/neo.highlight/grammars/' + language)
  return [language, module[language]]
})))
const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>')
const globals = ['window', 'document', 'navigator', 'Element', 'HTMLElement', 'HTMLStyleElement']
const descriptors = globals.map(name => Object.getOwnPropertyDescriptor(globalThis, name))
for (const name of globals) Object.defineProperty(globalThis, name, { value: dom.window[name], configurable: true })
after(() => {
  dom.window.close()
  globals.forEach((name, index) => {
    if (descriptors[index]) Object.defineProperty(globalThis, name, descriptors[index])
    else delete globalThis[name]
  })
})

const base = { grammars: [javascript], tokenize: highlight.tokenize, renderToHTML: highlight.renderToHTML, theme: githubDark }
const fence = (source, language = 'js', meta = '') => '```' + language + (meta ? ' ' + meta : '') + '\n' + source + '\n```'
const parser = options => markdown.createParser({ plugins: [highlightPlugin({ ...base, ...options })] })
const flush = () => new Promise(resolve => setTimeout(resolve, 0))

for (const injectStyles of [true, false]) test(`structured documents return used assets, diagnostics, and TOC with injection ${injectStyles}`, async () => {
  const p = sanitized.createParser({ allowHtml: true, sanitize: true, plugins: [
    codePresentationPlugin({ injectStyles, highlight: { ...base, injectStyles, styleMode: 'class', getThemeStylesheet: highlight.getThemeStylesheet } }),
    tocPlugin(), copyCodePlugin({ injectStyles }),
  ] })
  const input = '# Document *title*\n\n' + fence('- const x = 1;\n+ const x = 2;', 'js', 'diff focus=2 lines mark="2:7-2:8"')
  const result = p.parseDocument(input)
  assert.deepEqual(result.toc, [{ level: 1, text: 'Document title', id: 'document-title' }])
  assert.deepEqual(result.diagnostics, [])
  assert.equal(result.stylesheets.length, 3)
  assert.match(result.stylesheets.find(asset => asset.id === 'neo.highlight:neo-hl').css, /word-highlight/)
  assert.equal(result.html.includes('<style'), false)
  document.body.innerHTML = result.html
  assert.equal(document.querySelector('.neo-hl-word-highlight').textContent, 'x')
  assert.ok(document.querySelector('#' + result.toc[0].id))
  assert.equal(document.querySelector('pre [style], pre[style], [onclick]'), null)
  let copied
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { copied = text } } })
  const cleanup = initializeCopyCode()
  try { document.querySelector('[data-copy-code]').click(); await flush(); assert.equal(copied, 'const x = 2;\n') }
  finally { cleanup() }
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result)
  assert.deepEqual(p.parseDocument('empty').stylesheets, [])
  assert.deepEqual(p.renderDocument(p.tokenize(input)), result)
  assert.equal(p.parse(input).includes('<style>'), injectStyles)
})

test('structured diagnostics retain code-block positions and plain word selections after a syntax error', () => {
  const errors = []
  const p = sanitized.createParser({ allowHtml: true, sanitize: true, plugins: [codePresentationPlugin({
    highlight: { ...base, styleMode: 'class', errorPolicy: 'plain', tokenize: () => { throw new Error('<syntax failure>') },
      onError: error => errors.push(error.message), getThemeStylesheet: highlight.getThemeStylesheet },
  })] })
  const result = p.parseDocument(fence('const x = 1;', 'js', 'mark="1:7-1:8"') + '\n' + fence('const y = 2;', 'js', 'mark=bad'))
  assert.deepEqual(result.diagnostics.map(d => [d.code, d.codeBlock.index]), [['highlight-failed', 1], ['invalid-field', 2], ['highlight-failed', 2]])
  assert.deepEqual(errors, ['<syntax failure>', '<syntax failure>'])
  assert.equal(result.stylesheets.length, 1)
  document.body.innerHTML = result.html
  assert.equal(document.querySelector('.neo-code-word-highlight').textContent, 'x')
  assert.equal(document.querySelector('syntax'), null)
  assert.equal(result.diagnostics[0].message, '<syntax failure>')
  assert.deepEqual(p.parseDocument('no code').diagnostics, [])
})

test('sanitized custom allowlists cannot activate raw-text or SVG advisory payloads', () => {
  const p = sanitized.createParser({ allowHtml: true, sanitize: true,
    allowedTags: ['textarea', 'xmp', 'svg', 'animate', 'text'],
    allowedAttributes: { animate: ['attributename', 'values', 'dur', 'fill'] },
  })
  for (const source of [
    '<div><textarea></textarea/><img src=x onerror="alert(1)"></div>',
    '<div><xmp></xmp/><img src=x onerror="alert(1)"></div>',
    '<div><svg><a><animate attributeName="href" values="#safe;javascript:alert(1)" dur=".01s" fill="freeze"></animate><text>Click</text></a></svg></div>',
  ]) {
    document.body.innerHTML = p.parse(source)
    assert.equal(document.querySelector('svg, textarea, xmp, [onerror]'), null)
  }
})

test('normalizes aliases consistently in Markdown, registry, worker, and DOM scanning', () => {
  const grammar = { ...javascript, name: ' JavaScript ', aliases: [' JS '] }
  for (const language of ['js', 'JS', 'JavaScript', ' JAVASCRIPT ']) {
    assert.equal(highlight.resolveGrammar(language, [grammar]), grammar)
    assert.equal(highlight.createRegistry([grammar]).get(language.trim().toLowerCase()), grammar)
    assert.equal(handleHighlightWorkerRequest({ id: 1, code: 'const x = 1', language }).ok, true)
    const html = parser({ grammars: [grammar] }).parse(fence('const x = 1', language))
    assert.match(html, /neo-hl-keyword/)
    document.body.innerHTML = '<pre><code></code></pre>'
    const code = document.querySelector('code')
    code.setAttribute('data-language', language)
    code.textContent = 'const x = 1'
    assert.equal(highlight.scan({ languages: [grammar], container: document.body }), 1)
    assert.ok(code.querySelector('.neo-hl-keyword'))
  }
})

test('preserves text and escapes unknown languages and unlabelled fences', () => {
  const source = '<img src=x onerror="bad()"> & café 😀'
  for (const language of ['unknown', '']) {
    const html = parser().parse(fence(source, language))
    document.body.innerHTML = html
    assert.equal(document.querySelector('code').textContent, source + '\n')
    assert.equal(document.querySelector('img'), null)
  }
})

test('strict errors remain the default for an oversized block', () => {
  assert.throws(() => parser().parse(fence('x'.repeat(250_001))), /maxInputLength/)
})

test('plain recovery retains an oversized block and renders the rest of a UGC document', () => {
  const errors = []
  const source = '<script>' + 'x'.repeat(250_001) + '</script>'
  const p = markdown.createParser({ ugc: true, plugins: [highlightPlugin({
    ...base, errorPolicy: 'plain', onError: (error, context) => errors.push({ error, context }),
  })] })
  const html = p.parse(fence(source) + '\n\n# Still here\n\n' + fence('const next = 1'))
  document.body.innerHTML = html
  assert.equal(document.querySelectorAll('code')[0].textContent, source + '\n')
  assert.equal(document.querySelector('script'), null)
  assert.equal(document.querySelector('h1').textContent, 'Still here')
  assert.ok(document.querySelectorAll('code')[1].querySelector('.neo-hl-keyword'))
  assert.equal(errors.length, 1)
  assert.equal(errors[0].context.stage, 'tokenize')
  assert.equal(errors[0].context.code, source + '\n')
})

for (const [name, source] of [
  ['maxInputLength', 'const x = 1'], ['maxMatchCount', 'const x = 1'],
  ['maxTokenCount', 'const x = 1'], ['maxTokenDepth', 'const x = `hi ${name}`'],
  ['maxRenderedLength', 'const x = 1'], ['maxLines', 'const x = 1'],
]) {
  test(`enforces ${name} through real tokenizer and renderer callbacks`, () => {
    const errors = []
    const p = parser({ [name]: 0, errorPolicy: 'plain', onError: (error, context) => errors.push({ error, context }) })
    document.body.innerHTML = p.parse(fence(source))
    assert.equal(document.querySelector('code').textContent, source + '\n')
    assert.equal(errors.length, 1)
    assert.match(errors[0].error.message, new RegExp(name))
    assert.equal(errors[0].context.stage, ['maxRenderedLength', 'maxLines'].includes(name) ? 'render' : 'tokenize')
  })
}

test('retains theme classes, line highlights, and diff lines after structural sanitization', () => {
  const p = sanitized.createParser({ allowHtml: true, sanitize: true, plugins: [highlightPlugin({
    ...base, getThemeStylesheet: highlight.getThemeStylesheet, injectStyles: false,
    lineNumbers: true, diffHighlight: { added: [1], removed: [2] },
  })] })
  const html = p.parse('<script>bad()</script>\n\n' + fence('const first = 1\nconst second = 2', 'JS', '{2}'))
  document.body.innerHTML = html
  assert.equal(document.querySelector('style, script, [style]'), null)
  assert.ok(document.querySelector('.neo-hl-line-highlighted.neo-hl-diff-removed'))
  assert.ok(document.querySelector('.neo-hl-diff-added'))
  assert.equal(document.querySelectorAll('.neo-hl-line-number').length, 3)
  const css = highlight.getThemeStylesheet(githubDark)
  for (const selector of ['.neo-hl-keyword', '.neo-hl-line', '.neo-hl-line-highlighted', '.neo-hl-diff-added']) assert.ok(css.includes(selector))
})

test('emits inline theme CSS per document and permits explicit external assets', () => {
  const p = parser({ getThemeStylesheet: highlight.getThemeStylesheet })
  for (const source of ['const first = 1', 'const second = 2']) {
    assert.equal((p.parse(fence(source)).match(/<style>/g) ?? []).length, 1)
  }
  assert.doesNotMatch(parser({ getThemeStylesheet: highlight.getThemeStylesheet, injectStyles: false }).parse(fence('const x = 1')), /<style>/)
})

test('copies highlighted Unicode and CRLF input without line numbers or diff gutters', async (t) => {
  const source = 'const text = "<& café 😀>";\r\n\r\n\tconsole.log(text);'
  const copied = []
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { copied.push(text) } } })
  for (const sanitize of [false, true]) {
    const makeParser = sanitize ? sanitized.createParser : markdown.createParser
    const p = makeParser({ allowHtml: sanitize, sanitize, plugins: [
      copyCodePlugin({ injectStyles: false }),
      highlightPlugin({ ...base, classPrefix: 'custom', lineNumbers: true, diffHighlight: { added: [1], removed: [3] } }),
    ] })
    document.body.innerHTML = p.parse(fence(source, 'JS', '{1-3}'))
    const cleanup = initializeCopyCode({ root: document.body, resetDelay: 1 })
    t.after(cleanup)
    document.querySelector('button').click()
    await flush()
    assert.equal(copied.at(-1), source.replace(/\r\n/g, '\n') + '\n')
    cleanup()
  }
})

test('copies plain fallback blocks with markup and newlines intact', async () => {
  const source = '<img>\n& original'
  let copied
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { copied = text } } })
  document.body.innerHTML = markdown.parse(fence(source), { plugins: [
    highlightPlugin({ ...base, maxInputLength: 1, errorPolicy: 'plain' }), copyCodePlugin({ injectStyles: false }),
  ] })
  const cleanup = initializeCopyCode({ root: document.body })
  document.querySelector('button').click()
  await flush()
  cleanup()
  assert.equal(copied, source + '\n')
})

test('reports clipboard rejection and leaves the label unchanged', async () => {
  const error = new Error('clipboard denied')
  const errors = []
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw error } } })
  document.body.innerHTML = markdown.parse(fence('code'), { plugins: [copyCodePlugin({ injectStyles: false })] })
  const cleanup = initializeCopyCode({ root: document.body, onError: error => errors.push(error) })
  document.querySelector('button').click()
  await flush()
  cleanup()
  assert.deepEqual(errors, [error])
  assert.equal(document.querySelector('button').textContent, 'Copy')
})

test('cleanup prevents delayed feedback and future click handling', async () => {
  let resolveCopy
  let calls = 0
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
    writeText: () => { calls++; return new Promise(resolve => { resolveCopy = resolve }) },
  } })
  document.body.innerHTML = markdown.parse(fence('code'), { plugins: [copyCodePlugin({ injectStyles: false })] })
  const cleanup = initializeCopyCode({ root: document.body })
  const button = document.querySelector('button')
  button.click()
  await Promise.resolve()
  cleanup()
  resolveCopy()
  await flush()
  button.click()
  await flush()
  assert.equal(calls, 1)
  assert.equal(button.textContent, 'Copy')
})

test('class output shares one stylesheet across blocks and repeated documents', () => {
  let stylesheetCalls = 0
  const p = parser({ styleMode: 'class', lineNumbers: true, diffHighlight: { added: [1] },
    getThemeStylesheet: (theme, prefix) => {
      stylesheetCalls++
      return highlight.getThemeStylesheet(theme, prefix)
    },
  })
  const source = fence('const x = `<&>`', 'js', '{1}') + '\n\n' + fence('const y = 2')
  for (let i = 0; i < 2; i++) {
    document.body.innerHTML = p.parse(source)
    assert.equal(document.querySelectorAll('style').length, 1)
    assert.equal(document.querySelectorAll('pre').length, 2)
    assert.equal(document.querySelector('[style]'), null)
    assert.ok(document.querySelector('.neo-hl-line-highlighted.neo-hl-diff-added'))
  }
  assert.equal(stylesheetCalls, 1)
})

test('class output survives sanitization and preserves clipboard source with gutters', async () => {
  const source = 'const café = `<tag>${1}</tag>`;\n// 😀 & text'
  const p = sanitized.createParser({ allowHtml: true, sanitize: true, plugins: [highlightPlugin({
    ...base, styleMode: 'class', injectStyles: false, lineNumbers: true,
    diffHighlight: { added: [1], removed: [2] },
  }), copyCodePlugin({ injectStyles: false })] })
  document.body.innerHTML = p.parse(fence(source, 'JS', '{1}'))
  assert.equal(document.querySelector('pre [style], pre[style], style'), null)
  assert.ok(document.querySelector('.neo-hl-color-string'))
  let copied
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { copied = text } } })
  const cleanup = initializeCopyCode(document.body)
  document.querySelector('[data-copy-code]').click()
  await flush()
  assert.equal(copied, source + '\n')
  cleanup()
})

for (const [language, source, expected] of [
  ['javascript', String.raw`const f = function \u0066oo() {} / 2; /ok/.test(value);`, [['function', '\\u0066oo'], ['regex', '/ok/']]],
  ['typescript', 'const f = function(): {value: number} { return {value: 1} } / 2; /ok/.test(value);', [['regex', '/ok/'], ['keyword', 'return']]],
  ['tsx', 'const f = <T /* gap */,>(x: T) => x; const view = <Box />;', [['tag', '<Box />']]],
  ['html', '<script><!--<script></script>--></script><p>after</p>', [['script', '<!--<script></script>-->'], ['tag', '<p>']]],
  ['vue', '<p>{{ value } + <span>unfinished', [['interpolation', '{{ value } + <span>unfinished\n']]],

  ['python', 'f"{value!r:>{width}}"', [['conversion', '!r'], ['interpolation', '{width}']]],
  ['css', '.a,\n.b:hover { color: #abc; }', [['selector', '.a,\n.b:hover'], ['property', 'color']]],
  ['html', '<script>const x = true;</script><style>.a { color: red; }</style>', [['keyword', 'const'], ['property', 'color']]],
  ['vue', '<p>{{ value as string }}</p><script setup lang="ts">const value = "ok";</script>', [['keyword', 'as'], ['builtin', 'string']]],
  ['svelte', '{#if ready}<p title={format({x: true})} style="background: url({image})">{value}</p>{/if}', [['block', '{/if}'], ['boolean', 'true'], ['expression', '{image}']]],
]) {
  const grammar = expandedGrammars.get(language)
  test(`retains ${language} token spans through both output modes and sanitization`, () => {
    for (const styleMode of ['inline', 'class']) {
      const p = sanitized.createParser({ allowHtml: true, sanitize: true, plugins: [highlightPlugin({
        ...base, grammars: [grammar], styleMode, injectStyles: false,
      })] })
      document.body.innerHTML = p.parse(fence(source, language))
      const code = document.querySelector('code')
      assert.equal(code.textContent, source + '\n')
      assert.equal(code.querySelector('script, style, p, [onerror]'), null)
      for (const [type, text] of expected) {
        assert.ok([...code.querySelectorAll('.neo-hl-' + type)].some(node => node.textContent === text), `${type}: ${text}`)
      }
    }
  })
}

for (const styleMode of ['inline', 'class']) test(`structured metadata and hooks survive ${styleMode} rendering, sanitization, and copy`, async () => {
  const source = 'const café = "<img>";\nconsole.log(café);'
  const seen = []
  const p = sanitized.createParser({ allowHtml: true, sanitize: true,
    renderCodeBlock: (context, next) => '<figure><figcaption>' + markdown.escapeHtml(String(markdown.getCodeBlockMetadata(context).attributes.title)) + '</figcaption>' + next() + '</figure>',
    plugins: [copyCodePlugin({ injectStyles: false }), highlightPlugin({ ...base, styleMode, injectStyles: false,
      renderOptions: context => {
        seen.push(context)
        assert.equal(context.resolvedLanguage, 'javascript')
        return { lineNumbers: true, startLine: Number(context.metadata.attributes.start), hooks: {
          token: ({ type, start }) => type === 'keyword' ? { attributes: { 'data-start': start } } : undefined,
          line: ({ displayLine }) => ({ attributes: { id: `L${displayLine}` } }),
          pre: () => ({ attributes: { 'aria-label': 'Example <&>' } }),
        } }
      },
    })],
  })
  document.body.innerHTML = p.parse(fence(source, 'JS', 'title="<img onerror=bad()>" start=30 {2}'))
  assert.equal(document.querySelector('figcaption').textContent, '<img onerror=bad()>')
  assert.equal(document.querySelector('img, script, [onerror]'), null)
  assert.equal(document.querySelector('#L31 .neo-hl-line-number').textContent, '31')
  assert.ok(document.querySelector('#L31.neo-hl-line-highlighted'))
  assert.equal(document.querySelector('.neo-hl-keyword').getAttribute('data-start'), '0')
  assert.equal(document.querySelector('pre').getAttribute('aria-label'), 'Example <&>')
  assert.equal(seen.length, 1)
  assert.equal(seen[0].source, source + '\n')
  let copied
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { copied = text } } })
  const cleanup = initializeCopyCode({ root: document.body })
  document.querySelector('[data-copy-code]').click(); await flush(); cleanup()
  assert.equal(copied, source + '\n')
})

test('hook failures obey the highlight recovery policy', () => {
  const errors = []
  const p = parser({ hooks: { token: () => ({ attributes: { onclick: 'bad()' } }) }, errorPolicy: 'plain', onError: (error, context) => errors.push([error, context]) })
  document.body.innerHTML = p.parse(fence('const x = "<script>"'))
  assert.equal(document.querySelector('code').textContent, 'const x = "<script>"\n')
  assert.equal(document.querySelector('script, [onclick]'), null)
  assert.equal(errors[0][1].stage, 'render')
})

for (const mode of ['plain', 'unknown', 'inline', 'class']) {
  for (const copyFirst of [false, true]) test(`presentation ${mode}, copy first=${copyFirst}: captions, focus, diff, keyboard access, and clean copying`, async () => {
    const presentation = codePresentationPlugin({ injectStyles: false, classPrefix: 'example',
      highlight: mode === 'plain' ? undefined : { ...base, classPrefix: 'syntax', styleMode: mode === 'inline' ? 'inline' : 'class', injectStyles: false },
    })
    const copy = copyCodePlugin({ injectStyles: false })
    const parser = sanitized.createParser({ allowHtml: true, sanitize: true, plugins: copyFirst ? [copy, presentation] : [presentation, copy] })
    const source = '- const café = "old";\n+ const café = "<new>";\n  console.log(café);'
    const input = fence(source, mode === 'unknown' ? 'missing' : 'JS', 'caption="API <client>" filename=src/client.ts diff focus=2 lines start=20 {2}')
    document.body.innerHTML = parser.parse(input)
    assert.equal(document.querySelector('figcaption').textContent, 'API <client> — src/client.ts')
    assert.equal(document.querySelector('pre').tabIndex, 0)
    assert.equal(document.querySelector('pre').getAttribute('role'), 'region')
    assert.equal(document.querySelector('pre').getAttribute('aria-label'), 'API <client> — src/client.ts')
    assert.ok(document.querySelector('.example-focused[data-code-line="2"]'))
    assert.ok(document.querySelector('[data-code-line="1"][data-copy-code-exclude="true"]'))
    assert.equal(document.querySelector('[data-code-line="1"]').getAttribute('aria-label'), 'Removed line 20')
    assert.equal([...document.querySelectorAll('[data-code-line="2"] [aria-hidden="true"]')].at(-1)?.textContent, '21')
    assert.equal(document.querySelector('img, script, pre[style], pre [style], .example style'), null)
    if (mode === 'inline' || mode === 'class') assert.ok(document.querySelector('.syntax-keyword'))
    let copied
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { copied = text } } })
    const cleanup = initializeCopyCode({ root: document.body })
    document.querySelector('[data-copy-code]').click(); await flush()
    assert.equal(copied, 'const café = "<new>";\nconsole.log(café);\n')
    cleanup()
    assert.equal(parser.parse(input), parser.parse(input))
    assert.ok(getCodePresentationStyles({ classPrefix: 'example' }).includes('.example:focus-within'))
  })
}

test('presentation composes application hooks and per-block options around cleaned source', () => {
  const seen = []
  const parser = markdown.createParser({ plugins: [codePresentationPlugin({ injectStyles: false, highlight: {
    ...base, injectStyles: false, styleMode: 'class', diffHighlight: { modified: [3] },
    hooks: { token: ctx => { seen.push(ctx.source); return { class: 'custom-token' } }, line: ctx => ({ attributes: { 'data-app-line': ctx.line } }), code: () => ({ class: 'custom-code' }), pre: () => ({ class: 'custom-pre' }) },
    renderOptions: () => ({ highlightLines: [], lineNumbers: true, startLine: 30 }),
  } })] })
  document.body.innerHTML = parser.parse(fence('- const old = 1;\n+ const next = 2;\n  next;', 'js', 'diff {2} focus=2'))
  assert.ok(document.querySelector('pre.custom-pre .custom-code .custom-token'))
  assert.ok(document.querySelector('.neo-code-focused[data-app-line="2"]'))
  assert.ok(document.querySelector('[data-code-line="3"][data-code-diff="modified"]'))
  assert.equal(document.querySelector('.neo-hl-line-highlighted, .neo-code-highlighted'), null)
  assert.equal(document.querySelector('.neo-hl-line-number').textContent, '30')
  assert.ok(seen.length > 0)
  assert.ok(seen.every(source => source === 'const old = 1;\nconst next = 2;\nnext;\n'))
})

test('presentation rejects reserved hook attributes and keeps resource limits in plain recovery', () => {
  for (const attrs of [{ 'data-copy-code-exclude': 'false' }, { onclick: 'bad()' }]) {
    const parser = markdown.createParser({ plugins: [codePresentationPlugin({ injectStyles: false, highlight: {
      ...base, hooks: { line: () => ({ attributes: attrs }) },
    } })] })
    assert.throws(() => parser.parse(fence('- old', 'js', 'diff')), /attribute/)
  }
  const parser = markdown.createParser({ plugins: [codePresentationPlugin({ maxRenderedLength: 50, highlight: { ...base, errorPolicy: 'plain' } })] })
  assert.throws(() => parser.parse(fence('x', 'unknown', 'caption=Long')), /maxRenderedLength/)
})

test('presentation copying preserves empty lines and trailing newlines for manual tokens and all-removed blocks', async () => {
  const parser = markdown.createParser({ plugins: [codePresentationPlugin({ injectStyles: false }), copyCodePlugin({ injectStyles: false })] })
  let copied
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { copied = text } } })
  const cleanup = initializeCopyCode({ root: document.body })
  for (const [text, expected] of [['- old\r\n+ new\r\n\r\n  end', 'new\n\nend'], ['- old\n', ''], ['- old', ''], ['+ \n+ next\n', '\nnext\n']]) {
    document.body.innerHTML = parser.render([{ type: 'code', raw: '', meta: 'diff lines', text }])
    document.querySelector('[data-copy-code]').click(); await flush()
    assert.equal(copied, expected)
  }
  cleanup()
})

for (const mode of ['plain', 'unknown', 'inline', 'class']) test(`word selections preserve Unicode, diff copying, and sanitized ${mode} output`, async () => {
  const p = sanitized.createParser({ allowHtml: true, sanitize: true, plugins: [
    codePresentationPlugin({ injectStyles: false, highlight: mode === 'plain' ? undefined : { ...base, styleMode: mode === 'inline' ? 'inline' : 'class', injectStyles: false } }),
    copyCodePlugin({ injectStyles: false }),
  ] })
  const source = '- const value = `old`;\n+ const value = `😀 ${fn(true)}`;\n  // e\u0301 note'
  const input = fence(source, mode === 'unknown' ? 'missing' : 'JS', 'diff focus=2 lines start=40 mark="1:1-1:6,2:16-2:17,2:20-2:28,3:4-3:6"')
  document.body.innerHTML = p.parse(input)
  const marks = [...document.querySelectorAll('.neo-code-word-highlight, .neo-hl-word-highlight')]
  assert.equal(marks.map(node => node.textContent).join(''), 'const😀fn(true)e\u0301')
  assert.ok(document.querySelector('.neo-code-focused [class$="word-highlight"]'))
  assert.equal(document.querySelector('img, script, pre[style], pre [style], .neo-hl-line-number [class$="word-highlight"]'), null)
  if (mode === 'inline' || mode === 'class') assert.equal(document.querySelector('.neo-hl-boolean .neo-hl-word-highlight').textContent, 'true')
  let copied
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { copied = text } } })
  const cleanup = initializeCopyCode({ root: document.body })
  document.querySelector('[data-copy-code]').click(); await flush(); cleanup()
  assert.equal(copied, 'const value = `😀 ${fn(true)}`;\n// e\u0301 note\n')
  assert.equal(p.parse(input), p.parse(input))
})

test('range options pass through direct highlighting and override presentation metadata without changing budgets', () => {
  const direct = parser({ highlightRanges: [{ start: 6, end: 10 }] })
  document.body.innerHTML = direct.parse(fence('const name = 1'))
  assert.equal(document.querySelector('.neo-hl-word-highlight').textContent, 'name')
  for (const highlightRanges of [[], [{ start: 0, end: 5 }]]) {
    const p = markdown.createParser({ plugins: [codePresentationPlugin({ injectStyles: false, highlight: { ...base,
      renderOptions: () => ({ highlightRanges, maxRenderedLength: Infinity }), maxRenderedLength: 10_000,
    } })] })
    document.body.innerHTML = p.parse(fence('const name = 1', 'js', 'mark="1:7-1:11"'))
    assert.equal([...document.querySelectorAll('.neo-hl-word-highlight')].map(node => node.textContent).join(''), highlightRanges.length ? 'const' : '')
  }
  assert.throws(() => parser({ maxRenderedLength: 100, renderOptions: () => ({ highlightRanges: [{ start: 0, end: 14 }], maxRenderedLength: Infinity }) }).parse(fence('const name = 1')), /maxRenderedLength/)
})

test('plain recovery retains metadata word ranges and rejects invalid low-level selection bounds', () => {
  const errors = []
  const p = markdown.createParser({ plugins: [codePresentationPlugin({ injectStyles: false, highlight: { ...base,
    errorPolicy: 'plain', onError: (error, context) => errors.push(context.stage),
    renderOptions: () => ({ highlightRanges: [{ start: 0, end: 99999 }] }),
  } })] })
  document.body.innerHTML = p.parse(fence('const name = 1', 'js', 'mark="1:7-1:11"'))
  assert.equal(document.querySelector('.neo-code-word-highlight').textContent, 'name')
  assert.deepEqual(errors, ['render'])
})

test('GFM accuracy composes with structured results, TOC, and sanitization', () => {
  const parser = sanitized.createParser({ gfm: true, allowHtml: true, sanitize: true, plugins: [tocPlugin()] })
  const source = '# Contact\n\n~old~ foo@bar.com\n\n| a | b |\n| - | - |\nrow\n\n<div><script>bad()</script></div>'
  const result = parser.parseDocument(source)
  assert.equal(result.html, parser.parse(source))
  assert.deepEqual(result.toc, [{ level: 1, text: 'Contact', id: 'contact' }])
  document.body.innerHTML = result.html
  assert.equal(document.querySelector('a[href^="mailto:"]').getAttribute('href'), 'mailto:foo@bar.com')
  assert.equal(document.querySelector('del').textContent, 'old')
  assert.equal(document.querySelectorAll('tbody td').length, 2)
  assert.equal(document.querySelector('script'), null)
  assert.deepEqual(result.diagnostics, [])
})

for (const preview of ['highlight', 'plain']) test(`streamed ${preview} tokens preserve presentation, assets, and sanitized output`, () => {
  const streamed = (code, grammar, options) => {
    const stream = incrementalHighlight.createJavaScriptStream({ ...options, language: grammar.name, preview })
    let tokens = []
    try {
      for (let offset = 0; offset < code.length; offset += 7) tokens = incrementalHighlight.applyJavaScriptTokenUpdate(tokens, stream.append(code.slice(offset, offset + 7)))
      return incrementalHighlight.applyJavaScriptTokenUpdate(tokens, stream.finish())
    } finally { stream.dispose() }
  }
  const make = tokenize => sanitized.createParser({ allowHtml: true, sanitize: true, plugins: [
    codePresentationPlugin({ injectStyles: false, highlight: { ...base, tokenize, styleMode: 'class', getThemeStylesheet: highlight.getThemeStylesheet } }),
    tocPlugin(), copyCodePlugin({ injectStyles: false }),
  ] })
  const input = '# Streamed\n\n' + fence('- const value = 1;\n+ const value = `😀`;', 'js', 'diff focus=2 mark="2:7-2:12" caption=Example')
  const result = make(streamed).parseDocument(input)
  assert.deepEqual(result, make(highlight.tokenize).parseDocument(input))
  document.body.innerHTML = result.html
  assert.equal(document.querySelector('.neo-hl-word-highlight').textContent, 'value')
})

test('edited token snapshots compose with the built Markdown highlighter', () => {
  const initial = 'const first = 0;\nconst name = 1;\n'
  const session = incrementalHighlight.createJavaScriptDocument(initial)
  const first = session.snapshot()
  const offset = initial.indexOf('name')
  const patch = session.edit({ revision: 0, start: offset, end: offset + 4, text: 'changed' })
  const tokens = incrementalHighlight.applyJavaScriptTokenUpdate(first.tokens, patch)
  const source = session.snapshot().source
  const input = fence(source.slice(0, -1))
  assert.deepEqual(parser({ tokenize: code => { assert.equal(code, source); return tokens } }).parseDocument(input), parser({}).parseDocument(input))
  session.dispose()
})

test('incremental Markdown preserves repeated structured authoring results', () => {
  const plugins = () => [tocPlugin(), codePresentationPlugin({ highlight: { ...base, styleMode: 'class', getThemeStylesheet: highlight.getThemeStylesheet } }), copyCodePlugin()]
  const options = { gfm: true, allowHtml: true, sanitize: true, sanitizer: sanitized.sanitizeHtml }
  const session = createIncrementalMarkdown({ parser: { ...options, plugins: plugins() } })
  const ordinary = markdown.createParser({ ...options, plugins: plugins() })
  for (const input of ['# First\n\n' + fence('const name = 1;', 'js', 'caption=Example mark="1:7-1:11"'), '# Other\n\n' + fence('const x = 2;', 'js', 'focus=bad'), 'plain']) {
    assert.deepEqual(session.update(input), ordinary.parseDocument(input))
  }
  assert.equal(session.metrics.cacheEntries, 0)
  session.dispose()
})

test('resumed Markdown blocks preserve highlighting hooks and sanitized complete results', () => {
  let calls = 0
  const hook = (context, render) => {
    assert.ok(Object.isFrozen(context.token))
    return context.language === 'js'
      ? highlight.renderToHTML(highlight.tokenize(context.source, javascript), { theme: githubDark, styleMode: 'class' })
      : render()
  }
  const options = { gfm: true, allowHtml: true, sanitize: true, sanitizer: sanitized.sanitizeHtml }
  const session = createIncrementalMarkdown({ parser: { ...options, renderCodeBlock(context, render) { calls++; return hook(context, render) } } })
  const ordinary = markdown.createParser({ ...options, renderCodeBlock: hook })
  const initial = '# Kept\n\n- one\n- two\n\n[link][target]\n\n' + fence('const value = "<safe>";') + '\n\n[target]: /one\n'
  const first = session.update(initial)
  const saved = JSON.stringify(first)
  for (const source of [initial.replace('/one', '/two'), initial.replace('- two', '- changed\n\n  continued'), initial + '\na | b\n- | -\n']) {
    const result = session.update(source)
    assert.deepEqual(result, ordinary.parseDocument(source))
    assert.ok(Object.isFrozen(result))
    document.body.innerHTML = result.html
    assert.equal(document.querySelector('pre code').textContent, 'const value = "<safe>";\n')
    assert.equal(document.querySelector('safe, [style], script'), null)
  }
  assert.equal(calls, 4)
  assert.ok(session.metrics.reusedBlocks > 0)
  assert.equal(JSON.stringify(first), saved)
  session.dispose()
})

test('open nested fences continue while highlighting and sanitization render every update', () => {
  let calls = 0
  const hook = context => highlight.renderToHTML(highlight.tokenize(context.source, javascript), { theme: githubDark, styleMode: 'class' })
  const options = { gfm: true, allowHtml: true, sanitize: true, sanitizer: sanitized.sanitizeHtml }
  const session = createIncrementalMarkdown({ parser: { ...options, renderCodeBlock(context) { calls++; return hook(context) } } })
  const ordinary = markdown.createParser({ ...options, renderCodeBlock: hook })
  let source = '> - ```js\n' + '>   const value = "<safe>";\n'.repeat(12)
  const first = session.update(source), saved = JSON.stringify(first)
  for (const chunk of ['>   const next = 2;\n', '>   ``', '`\n>\n> | a | b |\n> | - | - |\n> | [x][r] | row |\n', '> | more | rows |\n\n[r]: /url\n']) {
    source += chunk
    const result = session.append(chunk)
    assert.deepEqual(result, ordinary.parseDocument(source))
    document.body.innerHTML = result.html
    assert.equal(document.querySelector('safe, [style], script'), null)
    assert.ok(document.querySelector('pre code').textContent.startsWith('const value = "<safe>";\n'))
  }
  assert.equal(calls, 5)
  assert.ok(session.metrics.continuationHits >= 3)
  assert.equal(JSON.stringify(first), saved)
  session.dispose()
})


test('declared rendering plugins preserve highlighted authoring output and repeated effects', () => {
  const make = presentation => {
    const effects = { toc: 0, render: 0 }
    const syntax = { ...base, styleMode: 'class', getThemeStylesheet: highlight.getThemeStylesheet,
      renderOptions() { effects.render++; return { lineNumbers: true } } }
    const plugins = [tocPlugin({ onToc() { effects.toc++ } }),
      presentation ? codePresentationPlugin({ highlight: syntax }) : highlightPlugin(syntax), copyCodePlugin()]
    return { effects, plugins: plugins.map((plugin, i) => defineIncrementalPlugin(plugin, { protocol: 1, id: 'render:' + i, profile: 'render' })) }
  }
  for (const presentation of [false, true]) {
    const actual = make(presentation), expected = make(presentation)
    const options = { gfm: true, allowHtml: true, sanitize: true, sanitizer: sanitized.sanitizeHtml }
    const session = createIncrementalMarkdown({ pluginReuse: 'declared', parser: { ...options, plugins: actual.plugins } })
    const ordinary = markdown.createParser({ ...options, plugins: expected.plugins })
    const source = '# Same\n\n# Same\n\n' + fence('const value = "<safe>";', 'js', 'caption=Example mark="1:7-1:12"') + '\n\n[link][r]\n\n[r]: /one\n'
    let first, saved
    const nested = '> - ```js\n' + '>   const x = 1;\n'.repeat(6)
    for (const input of [source, source, source.replace('/one', '/two'), source.replace('caption=Example', 'caption=Other'), nested, nested + '>   const y = 2;\n']) {
      const result = session.update(input)
      assert.deepEqual(result, ordinary.parseDocument(input))
      assert.deepEqual(actual.effects, expected.effects)
      document.body.innerHTML = result.html
      assert.equal(document.querySelector('safe, [style], script'), null)
      assert.ok(document.querySelector('pre code').textContent.includes('const '))
      assert.ok(result.stylesheets.length > 0)
      if (!first) { first = result; saved = JSON.stringify(result) }
      assert.equal(JSON.stringify(first), saved)
    }
    assert.equal(session.reuse.mode, 'declared')
    assert.ok(session.metrics.reusedBlocks > 0)
    assert.ok(session.metrics.continuationHits > 0)
    assert.ok(session.metrics.clonedTokenNodes > 0)
    session.dispose()
    assert.equal(session.metrics.cachedBlockCodeUnits, 0)
  }
})

test('pure inline revisions compose with highlighted presentation, copying, TOC, and sanitizer results', () => {
  const make = () => {
    const state = { revision: 'A', href: '/A', inline: 0, render: 0, toc: 0 }
    const plugins = [defineIncrementalPlugin(builder => {
      builder.addInlineRule({ name: 'glossary', triggerChars: [64], tokenize: source => {
        state.inline++
        return source.startsWith('@neo') ? { raw: '@neo', token: { type: 'link', raw: '@neo', href: state.href,
          tokens: [{ type: 'text', raw: '@neo', text: 'Neo' }] } } : null
      } })
    }, { protocol: 1, id: 'glossary', profile: 'inline', effects: 'none', dependencies: { kind: 'revision', read: () => state.revision } }),
    ...[tocPlugin({ onToc() { state.toc++ } }), codePresentationPlugin({ highlight: {
      ...base, getThemeStylesheet: highlight.getThemeStylesheet, styleMode: 'class', renderOptions() { state.render++; return {} },
    } }), copyCodePlugin()].map((plugin, i) => defineIncrementalPlugin(plugin, { protocol: 1, id: 'render:' + i, profile: 'render' }))]
    return { state, options: { gfm: true, allowHtml: true, sanitize: true, sanitizer: sanitized.sanitizeHtml, plugins } }
  }
  const actual = make(), expected = make()
  const session = createIncrementalMarkdown({ pluginReuse: 'declared', parser: actual.options })
  const parser = markdown.createParser(expected.options)
  const nested = '> - ```js caption=Example\n' + '>   const x = "<safe>";\n'.repeat(6)
  const text = '# @neo\n\n@neo **text** [r]\n\n[r]: /reference\n\n' + nested
  let first, snapshot
  for (const [revision, href, input] of [['A', '/A', text], ['A', '/A', text], ['B', 'javascript:alert(1)', text], ['A', '/A', text], ['A', '/A', text + '>   const y = 2;\n']]) {
    Object.assign(actual.state, { revision, href }); Object.assign(expected.state, { revision, href })
    const result = session.update(input)
    assert.deepEqual(result, parser.parseDocument(input))
    assert.equal(actual.state.toc, expected.state.toc)
    assert.equal(actual.state.render, expected.state.render)
    document.body.innerHTML = result.html
    assert.equal(document.querySelector('safe, script, [style], [href^="javascript:"]'), null)
    assert.ok(result.stylesheets.length > 0)
    assert.ok(document.querySelector('button[data-copy-code]'))
    if (!first) { first = result; snapshot = JSON.stringify(result) }
    assert.equal(JSON.stringify(first), snapshot)
  }
  assert.ok(actual.state.inline < expected.state.inline)
  assert.equal(session.metrics.pluginInvalidations, 2)
  assert.ok(session.metrics.reusedBlocks > 0)
  assert.ok(session.metrics.continuationHits > 0)
  session.dispose()
})
