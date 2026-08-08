import { describe, expect, it } from 'vitest'
import { parse } from '../../src/index.js'

// Selected normative fixtures from the official GFM 0.29 specification:
// https://github.github.com/gfm/
describe('official GFM 0.29 extension fixtures', () => {
  it('parses escaped pipes in tables', () => {
    const markdown = '| f\\|oo  |\n| ------ |\n| b `\\|` az |\n| b **\\|** im |'
    expect(parse(markdown, { gfm: true, lazyImages: false })).toBe(
      '<table>\n<thead>\n<tr>\n<th>f|oo</th>\n</tr>\n</thead>\n<tbody>\n' +
      '<tr>\n<td>b <code>|</code> az</td>\n</tr>\n' +
      '<tr>\n<td>b <strong>|</strong> im</td>\n</tr>\n' +
      '</tbody>\n</table>\n'
    )
  })

  it('rejects a table whose header and delimiter widths differ', () => {
    const markdown = '| abc | def |\n| --- |\n| bar |'
    expect(parse(markdown, { gfm: true })).toBe(
      '<p>| abc | def |\n| --- |\n| bar |</p>\n'
    )
  })

  it('renders task-list markers only in GFM mode', () => {
    const markdown = '- [ ] foo\n- [x] bar'
    const html = parse(markdown, { gfm: true })
    expect(html).toContain('<input type="checkbox" disabled> foo')
    expect(html).toContain('<input type="checkbox" checked disabled> bar')
    expect(parse(markdown, { gfm: false })).not.toContain('<input')
  })

  it('excludes punctuation and unmatched parentheses from autolinks', () => {
    const markdown = 'Visit www.commonmark.org.\n\n(www.google.com/search?q=Markup+(business))'
    const html = parse(markdown, { gfm: true })
    expect(html).toContain('<a href="http://www.commonmark.org">www.commonmark.org</a>.')
    expect(html).toContain(
      '(<a href="http://www.google.com/search?q=Markup+(business)">' +
      'www.google.com/search?q=Markup+(business)</a>)'
    )
  })
})
