import { describe, expect, it, vi } from 'vitest'
import { createParser, parse, parseDocument, escapeHtml } from '../../src/index.js'
import { parseDocument as sanitizedDocument, createParser as sanitizedParser } from '../../src/sanitized.js'
import { parseDocument as commonmarkDocument } from '../../src/presets/commonmark.js'
import { parseDocument as gfmDocument } from '../../src/presets/gfm.js'
import { codePresentationPlugin } from '../../src/plugins/code-presentation.js'
import { copyCodePlugin } from '../../src/plugins/copy-code.js'
import { highlightPlugin } from '../../src/plugins/highlight.js'
import { tocPlugin } from '../../src/plugins/toc.js'
import { embedPlugin } from '../../src/plugins/embeds.js'
import type { DocumentContext, DocumentOptions, DocumentResult, MarkdownPlugin } from '../../src/index.js'

const fence = (meta = '', language = 'js', source = 'const x = 1;') => '```' + language + ' ' + meta + '\n' + source + '\n```\n'
const grammar = { name: 'javascript', aliases: ['js'], tokens: {} }
const highlight = {
  grammars: [grammar], tokenize: (code: string) => [code],
  renderToHTML: (tokens: string[]) => '<pre><code>' + escapeHtml(tokens.join('')) + '</code></pre>',
  theme: { name: 'sample' }, getThemeStylesheet: () => '.sample{color:red}',
}
const warning = { source: 'test', code: 'test-warning', severity: 'warning' as const, message: '<untrusted>' }

describe('structured document results', () => {
  it('keeps optionless string output and supplies empty immutable collections', () => {
    const source = '# Heading\n\nA **paragraph**.'
    const result = parseDocument(source)
    expect(result).toEqual({ html: parse(source), stylesheets: [], diagnostics: [], toc: [] })
    for (const value of [result, result.stylesheets, result.diagnostics, result.toc]) expect(Object.isFrozen(value)).toBe(true)
    expect(JSON.parse(JSON.stringify(result))).toEqual(result)
    expect(parseDocument('next').html).toBe('<p>next</p>\n')
  })

  it('supports configured default, sanitized, CommonMark, and GFM entry functions', () => {
    for (const run of [parseDocument, sanitizedDocument, commonmarkDocument, gfmDocument]) {
      expect(run('# title', { plugins: [tocPlugin()] }).toc).toEqual([{ level: 1, text: 'title', id: 'title' }])
      expect(run('plain').toc).toEqual([])
      expect(() => run('# title', { plugins: [tocPlugin()] }, { maxTocEntries: 0 })).toThrow('maxTocEntries')
    }
    expect(commonmarkDocument('~~x~~').html).toContain('~~x~~')
    expect(gfmDocument('~~x~~').html).toContain('<del>x</del>')
    expect(sanitizedDocument('<p onclick="bad()">ok</p>', { allowHtml: true, sanitize: true }).html).toBe('<p>ok</p>\n')
  })

  it('renders caller tokens through transforms once without changing them', () => {
    const transform = vi.fn(tokens => tokens)
    const parser = createParser({ plugins: [tocPlugin(), builder => builder.addTokenTransform(transform)] })
    const tokens = parser.tokenize('# A\n\n> ## B')
    const saved = JSON.stringify(tokens)
    const result = parser.renderDocument(tokens)
    expect(transform).toHaveBeenCalledTimes(1)
    expect(result.toc.map(entry => entry.id)).toEqual(['a', 'b'])
    expect(JSON.stringify(tokens)).toBe(saved)
    expect(parser.parseDocument('# A\n\n> ## B')).toEqual(result)
  })

  it.each([true, false])('collects used CSS once with injectStyles=%s and keeps string behavior', injectStyles => {
    const parser = createParser({ plugins: [
      codePresentationPlugin({ injectStyles, highlight: { ...highlight, injectStyles } }),
      copyCodePlugin({ injectStyles }),
    ] })
    const source = fence('caption=Example') + '\n' + fence()
    const legacy = parser.parse(source)
    const result = parser.parseDocument(source)
    expect(result.html).not.toContain('<style>')
    expect(result.stylesheets.map(style => style.id)).toEqual([
      'neo.markdown:code-presentation:neo-code', 'neo.highlight:neo-hl', 'neo.markdown:copy-code:code-block:copy-code-button',
    ])
    expect(result.html).toBe(legacy.replace(/<style>[\s\S]*?<\/style>/g, ''))
    expect(parser.parse(source)).toBe(legacy)
    expect(parser.parseDocument('plain').stylesheets).toEqual([])
    expect(parser.parseDocument('The data-copy-code-wrapper attribute').stylesheets).toEqual([])
  })

  it('generates disabled-injection CSS only for a successful structured highlight', () => {
    const css = vi.fn(highlight.getThemeStylesheet)
    const parser = createParser({ plugins: [highlightPlugin({ ...highlight, getThemeStylesheet: css, injectStyles: false })] })
    parser.parse(fence())
    parser.parseDocument('plain')
    expect(css).not.toHaveBeenCalled()
    expect(parser.parseDocument(fence()).stylesheets).toEqual([{ id: 'neo.highlight:neo-hl', css: '.sample{color:red}' }])
    expect(css).toHaveBeenCalledTimes(1)
    expect(parser.parseDocument(fence()).stylesheets).toHaveLength(1)
  })

  it('retains explicit raw HTML styles and custom HTML transforms', () => {
    const parser = createParser({ allowHtml: true, plugins: [builder => builder.addHtmlTransform(html => '<style>.custom{}</style>' + html)] })
    const source = '<style>.raw{}</style>\n'
    expect(parser.parseDocument(source).html).toBe(parser.parse(source))
    expect(parser.parseDocument(source).stylesheets).toEqual([])
  })

  it('collects metadata and presentation feedback once with nested block locations', () => {
    const callback = vi.fn()
    const parser = createParser({ plugins: [codePresentationPlugin({ highlight, onDiagnostic: callback })] })
    const result = parser.parseDocument(fence('title=a title=b mark=bad') + '\n> ' + fence('focus=bad').trim().replace(/\n/g, '\n> '))
    expect(result.diagnostics.map(d => [d.source, d.code, d.field, d.codeBlock?.index])).toEqual([
      ['code-metadata', 'duplicate-key', undefined, 1],
      ['code-presentation', 'invalid-field', 'mark', 1],
      ['code-presentation', 'invalid-field', 'focus', 2],
    ])
    expect(result.diagnostics[0].metaRange).toEqual({ start: 8, end: 15 })
    expect(result.diagnostics.every(d => d.codeBlock?.language === 'js')).toBe(true)
    expect(callback).toHaveBeenCalledTimes(2)
    for (const diagnostic of result.diagnostics) {
      expect(Object.isFrozen(diagnostic)).toBe(true)
      expect(Object.isFrozen(diagnostic.codeBlock)).toBe(true)
    }
  })

  it('reports highlight recovery and unknown grammars while keeping callbacks and strict errors', () => {
    const onError = vi.fn()
    const options = { ...highlight, tokenize: () => { throw new Error('<failed>') }, onError, errorPolicy: 'plain' as const }
    const parser = createParser({ plugins: [highlightPlugin(options)] })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const result = parser.parseDocument(fence() + '\n' + fence('title=a title=b', 'missing'))
      expect(result.diagnostics.map(d => d.code)).toEqual(['highlight-failed', 'duplicate-key', 'unknown-language'])
      expect(result.diagnostics[0]).toMatchObject({ message: '<failed>', field: 'tokenize', codeBlock: { index: 1 } })
      expect(result.stylesheets).toEqual([])
      expect(onError).toHaveBeenCalledTimes(1)
      expect(() => createParser({ plugins: [highlightPlugin({ ...options, errorPolicy: 'throw' })] }).parseDocument(fence())).toThrow('<failed>')
    } finally { warn.mockRestore() }
  })

  it('reports unavailable class styles without importing a highlighter dependency', () => {
    const result = createParser({ plugins: [highlightPlugin({ ...highlight, styleMode: 'class', getThemeStylesheet: undefined })] }).parseDocument(fence())
    expect(result.stylesheets).toEqual([])
    expect(result.diagnostics[0].code).toBe('stylesheet-unavailable')
  })

  it('collects TOC entries from rendered headings with independent slugs and legacy callbacks', () => {
    const callback = vi.fn(entries => { entries[0].text = 'callback mutation' })
    const parser = createParser({ plugins: [tocPlugin({ onToc: callback, maxDepth: 3 }), builder => builder.addTokenTransform(tokens => tokens.slice(1))] })
    const result = parser.parseDocument('# removed\n\n## Same *label*\n\n> ## Same *label*\n\n#### outside')
    expect(result.toc).toEqual([{ level: 2, text: 'Same label', id: 'same-label' }, { level: 2, text: 'Same label', id: 'same-label-1' }])
    expect(callback).toHaveBeenCalledTimes(1)
    expect(result.html).toContain('id="same-label-1"')
    expect(Object.isFrozen(result.toc[0])).toBe(true)
    expect(parser.parseDocument('empty').toc).toEqual([])
    expect(parser.parseDocument('# removed\n\n## Same *label*').toc[0].id).toBe('same-label')
  })

  it('isolates nested structured and string calls, parser reuse, and retained contexts', () => {
    let current: DocumentContext | undefined
    let nested: DocumentResult | undefined
    let recurse = true
    const plugin: MarkdownPlugin = builder => builder.addCodeBlockHook((_context, render) => {
      const document = builder.document
      if (document) {
        current = document
        document.reportDiagnostic(warning)
        if (recurse) {
          recurse = false
          nested = parser.parseDocument(fence())
          expect(parser.parse(fence())).toContain('<pre>')
          expect(builder.document).toBe(document)
        }
      }
      return render()
    })
    const parser = createParser({ plugins: [plugin] })
    const outer = parser.parseDocument(fence() + '\n' + fence())
    expect(outer.diagnostics.map(d => d.codeBlock?.index)).toEqual([1, 2])
    expect(nested?.diagnostics.map(d => d.codeBlock?.index)).toEqual([1])
    expect(() => current!.reportDiagnostic(warning)).toThrow('closed')
    expect(parser.parseDocument('empty').diagnostics).toEqual([])
    expect(createParser({ plugins: [plugin] }).parseDocument(fence()).diagnostics).toHaveLength(1)
  })

  it('restores collection state after a failed call and rejects late writes', () => {
    let saved: DocumentContext | undefined
    let fail = true
    const parser = createParser({ plugins: [builder => builder.addHtmlTransform(html => {
      saved = builder.document
      if (fail) { fail = false; throw new Error('transform failed') }
      return html
    })] })
    expect(() => parser.parseDocument('x')).toThrow('transform failed')
    expect(() => saved!.addTocEntry({ level: 1, id: 'late', text: 'late' })).toThrow('closed')
    expect(parser.parse('ok')).toBe('<p>ok</p>\n')
    expect(saved).toBeUndefined()
    expect(parser.parseDocument('ok').diagnostics).toEqual([])
  })

  it('preserves deferred embeds across nested document and string renders', () => {
    let recurse = true
    const parser = sanitizedParser({ allowHtml: true, sanitize: true, plugins: [embedPlugin({ youtube: true }), builder => builder.addCodeBlockHook((_context, render) => {
      if (recurse) { recurse = false; parser.parseDocument('::youtube[nested]'); parser.parse('::youtube[legacy]') }
      return render()
    })] })
    const result = parser.parseDocument('::youtube[dQw4w9WgXcQ]\n\n' + fence())
    expect(result.html).toContain('youtube-nocookie.com/embed/dQw4w9WgXcQ')
    expect(result.html).not.toContain('NEOMARKDOWNEMBED')
  })

  it('deduplicates snapshots, rejects CSS conflicts, and ignores extra plugin object properties', () => {
    const asset = { id: '__proto__', css: '.safe{}' }
    const parser = createParser({ plugins: [builder => builder.addHtmlTransform(html => {
      builder.document?.addStylesheet(asset)
      builder.document?.addStylesheet({ ...asset })
      builder.document?.reportDiagnostic({ ...warning, extra: new Error('private') } as never)
      return html
    })] })
    const result = parser.parseDocument('x')
    asset.css = '.changed{}'
    expect(result.stylesheets).toEqual([{ id: '__proto__', css: '.safe{}' }])
    expect(Object.isFrozen(result.stylesheets[0])).toBe(true)
    expect(JSON.parse(JSON.stringify(result)).diagnostics[0]).toEqual(warning)
    const conflicting = createParser({ plugins: [builder => builder.addHtmlTransform(html => {
      builder.document?.addStylesheet({ id: 'same', css: 'a{}' })
      builder.document?.addStylesheet({ id: 'same', css: 'b{}' })
      return html
    })] })
    expect(() => conflicting.parseDocument('x')).toThrow('Conflicting stylesheet')
  })

  it.each(['maxStylesheets', 'maxStylesheetLength', 'maxDiagnostics', 'maxTocEntries'] as const)('enforces %s without changing string calls', key => {
    const parser = createParser({ plugins: [tocPlugin(), codePresentationPlugin()] })
    const source = '# Heading\n\n' + fence('mark=bad')
    expect(() => parser.parseDocument(source, { [key]: 0 })).toThrow(key)
    expect(() => parser.parse(source)).not.toThrow()
    expect(() => parser.parseDocument(source, { [key]: Infinity })).not.toThrow()
    for (const invalid of [-1, .5, NaN, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => parser.parseDocument('x', { [key]: invalid } as DocumentOptions)).toThrow(key)
    }
  })

  it('does not swallow collection failures under highlight recovery', () => {
    const parser = createParser({ plugins: [highlightPlugin({ ...highlight, errorPolicy: 'plain' })] })
    expect(() => parser.parseDocument(fence(), { maxStylesheetLength: 1 })).toThrow('maxStylesheetLength')
    expect(parser.parseDocument(fence()).stylesheets).toHaveLength(1)
  })

  it('rejects malformed contributions and counts combined CSS size', () => {
    const actions: ((context: DocumentContext) => void)[] = [
      context => context.addStylesheet({ id: '', css: '' }),
      context => context.addStylesheet({ id: 'id', css: 1 } as never),
      context => context.reportDiagnostic({ ...warning, severity: 'info' } as never),
      context => context.reportDiagnostic({ ...warning, field: 1 } as never),
      context => context.reportDiagnostic({ ...warning, codeBlock: { index: 0 } }),
      context => context.reportDiagnostic({ ...warning, codeBlock: { index: 1, language: 1 } } as never),
      context => context.reportDiagnostic({ ...warning, metaRange: { start: 2, end: 1 } }),
      context => context.addTocEntry({ level: 7, id: 'id', text: 'title' }),
      context => context.addTocEntry({ level: 1, id: 'id', text: false } as never),
    ]
    for (const action of actions) {
      const parser = createParser({ plugins: [builder => builder.addHtmlTransform(html => { action(builder.document!); return html })] })
      expect(() => parser.parseDocument('x')).toThrow(TypeError)
    }
    const parser = createParser({ plugins: [builder => builder.addHtmlTransform(html => {
      builder.document?.addStylesheet({ id: 'a', css: 'a{}' })
      builder.document?.addStylesheet({ id: 'b', css: 'b{}' })
      return html
    })] })
    expect(() => parser.parseDocument('x', { maxStylesheetLength: 5 })).toThrow('maxStylesheetLength')
    expect(parser.parseDocument('x', { maxStylesheetLength: 6 }).stylesheets).toHaveLength(2)
  })

  it('does not return partial results when a plugin catches a collection error', () => {
    const parser = createParser({ plugins: [builder => builder.addHtmlTransform(html => {
      try {
        builder.document?.addStylesheet({ id: 'same', css: 'a{}' })
        builder.document?.addStylesheet({ id: 'same', css: 'b{}' })
      } catch { /* The outer document call must still fail. */ }
      return html
    })] })
    expect(() => parser.parseDocument('x')).toThrow('Conflicting stylesheet')
    expect(() => parser.parse('x')).not.toThrow()
  })

  it('keeps sanitizer, input, token-graph, and synchronous-output checks active', () => {
    const parser = createParser({ maxInputLength: 2 })
    expect(() => parser.parseDocument('long')).toThrow('maxInputLength')
    expect(() => parser.renderDocument([{ type: 'html', raw: '', text: '<script>x</script>' }])).toThrow('allowHtml')
    const cyclic: any[] = []; cyclic.push({ type: 'blockquote', raw: '', tokens: cyclic })
    expect(() => parser.renderDocument(cyclic)).toThrow('Cyclic')
    const asyncParser = createParser({ plugins: [builder => builder.addHtmlTransform((() => Promise.resolve('x')) as never)] })
    expect(() => asyncParser.parseDocument('x')).toThrow('Document HTML')
  })
})
