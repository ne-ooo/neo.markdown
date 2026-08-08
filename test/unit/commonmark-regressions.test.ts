import { describe, expect, it } from 'vitest'
import { parse } from '../../src/index.js'

describe('CommonMark subset regressions', () => {
  it('lets block headings interrupt paragraphs', () => {
    expect(parse('paragraph\n# heading')).toBe('<p>paragraph</p>\n<h1>heading</h1>\n')
  })

  it('supports longer and unclosed fenced code blocks', () => {
    expect(parse('````js\ncode\n`````')).toBe(
      '<pre><code class="language-js">code</code></pre>\n'
    )
    expect(parse('~~~\nunclosed')).toBe('<pre><code>unclosed</code></pre>\n')
  })

  it('does not close a fence with a shorter delimiter run', () => {
    const html = parse('````\ncode\n```')
    expect(html).toContain('code\n```')
  })

  it('removes valid closing ATX hashes only', () => {
    expect(parse('# heading ###')).toBe('<h1>heading</h1>\n')
    expect(parse('# heading###')).toBe('<h1>heading###</h1>\n')
  })

  it('preserves inline HTML only when explicitly enabled', () => {
    expect(parse('hello <span>world</span>', { allowHtml: true })).toBe(
      '<p>hello <span>world</span></p>\n'
    )
    expect(parse('hello <span>world</span>')).toContain('&lt;span&gt;world&lt;/span&gt;')
  })

  it('supports full, collapsed, shortcut, and image references', () => {
    const markdown = [
      '[site]: https://example.com "Example"',
      '[logo]: /logo.png',
      '',
      '[Visit][site] [site][] [site] ![Logo][logo]',
    ].join('\n')
    const html = parse(markdown)

    expect(html.match(/href="https:\/\/example.com"/g)).toHaveLength(3)
    expect(html).toContain('title="Example"')
    expect(html).toContain('<img src="/logo.png" alt="Logo"')
    expect(html).not.toContain('[site]:')
  })

  it('does not create emphasis from intraword underscores', () => {
    expect(parse('foo_bar_baz')).toBe('<p>foo_bar_baz</p>\n')
    expect(parse('foo__bar__baz')).toBe('<p>foo__bar__baz</p>\n')
  })
})
