import { describe, it, expect } from 'vitest'
import { createParser, HtmlRenderer, parse } from '../../src/index.js'

describe('createParser', () => {
  it('returns an object with a parse method', () => {
    const parser = createParser()
    expect(typeof parser.parse).toBe('function')
  })

  it('parses basic markdown to HTML', () => {
    const parser = createParser()
    expect(parser.parse('# Hello')).toBe('<h1>Hello</h1>\n')
  })

  it('each call returns a new independent instance', () => {
    const p1 = createParser()
    const p2 = createParser()
    expect(p1).not.toBe(p2)
    expect(p1.parse('# A')).toBe(p2.parse('# A'))
  })

  it('accepts gfm option', () => {
    const parser = createParser({ gfm: true })
    // GFM enables tables
    const md = '| a | b |\n|---|---|\n| 1 | 2 |'
    const html = parser.parse(md)
    expect(html).toContain('<table>')
  })

  it('accepts allowHtml option — passes through block-level HTML', () => {
    const parser = createParser({ allowHtml: true })
    const html = parser.parse('<div>raw block</div>')
    expect(html).toContain('<div>raw block</div>')
  })

  it('escapes raw HTML by default (allowHtml: false)', () => {
    const parser = createParser({ allowHtml: false })
    const html = parser.parse('<div>raw block</div>')
    expect(html).not.toContain('<div>raw block</div>')
  })

  it('also has a tokenize method', () => {
    const parser = createParser()
    const tokens = parser.tokenize('# Hello')
    expect(Array.isArray(tokens)).toBe(true)
    expect(tokens.length).toBeGreaterThan(0)
    expect(tokens[0]?.type).toBe('heading')
  })
})

describe('HtmlRenderer', () => {
  it('can be instantiated', () => {
    const renderer = new HtmlRenderer()
    expect(renderer).toBeDefined()
  })

  it('heading renders h1-h6', () => {
    const renderer = new HtmlRenderer()
    for (let level = 1; level <= 6; level++) {
      const html = renderer.heading({ type: 'heading', level, text: 'Test', tokens: [{ type: 'text', text: 'Test' }] } as any)
      expect(html).toBe(`<h${level}>Test</h${level}>\n`)
    }
  })

  it('hr renders self-closing tag', () => {
    const renderer = new HtmlRenderer()
    expect(renderer.hr({ type: 'hr' })).toBe('<hr>\n')
  })

  it('code renders pre/code block', () => {
    const renderer = new HtmlRenderer()
    const html = renderer.code({ type: 'code', text: 'console.log("hi")', lang: undefined, escaped: false })
    expect(html).toContain('<pre><code>')
    expect(html).toContain('console.log')
  })

  it('code with lang adds class attribute', () => {
    const renderer = new HtmlRenderer()
    const html = renderer.code({ type: 'code', text: 'x = 1', lang: 'python', escaped: false })
    expect(html).toContain('class="language-python"')
  })

  it('blockquote wraps in blockquote tags', () => {
    const renderer = new HtmlRenderer()
    const html = renderer.blockquote({ type: 'blockquote', tokens: [] })
    expect(html).toContain('<blockquote>')
    expect(html).toContain('</blockquote>')
  })

  it('list renders ul for unordered', () => {
    const renderer = new HtmlRenderer()
    const html = renderer.list({ type: 'list', ordered: false, start: 1, items: [] })
    expect(html).toContain('<ul>')
    expect(html).toContain('</ul>')
  })

  it('list renders ol for ordered', () => {
    const renderer = new HtmlRenderer()
    const html = renderer.list({ type: 'list', ordered: true, start: 1, items: [] })
    expect(html).toContain('<ol>')
  })

  it('ordered list with non-1 start includes start attribute', () => {
    const renderer = new HtmlRenderer()
    const html = renderer.list({ type: 'list', ordered: true, start: 3, items: [] })
    expect(html).toContain('start="3"')
  })
})

describe('escape utils (via parse output)', () => {
  it('escapes & in code blocks', () => {
    const html = parse('```\na & b\n```')
    expect(html).toContain('a &amp; b')
  })

  it('escapes < and > in code blocks', () => {
    const html = parse('`<script>`')
    expect(html).toContain('&lt;script&gt;')
  })

  it('blocks javascript: protocol in links', () => {
    const html = parse('[click](javascript:alert(1))')
    expect(html).not.toContain('javascript:')
  })

  it('blocks data: protocol in links', () => {
    const html = parse('[click](data:text/html,<script>)')
    expect(html).not.toContain('data:')
  })

  it('allows https: protocol in links', () => {
    const html = parse('[click](https://example.com)')
    expect(html).toContain('https://example.com')
  })
})

describe('parse (default export function)', () => {
  it('parses empty string to empty string', () => {
    expect(parse('')).toBe('')
  })

  it('parses paragraph', () => {
    expect(parse('Hello world')).toContain('<p>Hello world</p>')
  })

  it('parses multiple blocks', () => {
    const html = parse('# Title\n\nParagraph.')
    expect(html).toContain('<h1>Title</h1>')
    expect(html).toContain('<p>Paragraph.</p>')
  })
})
