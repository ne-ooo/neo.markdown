import { describe, expect, it } from 'vitest'
import { createParser, parse } from '../../src/index.js'
import { parse as sanitize } from '../../src/sanitized.js'
import { InlineTokenizer } from '../../src/core/inline-tokenizer.js'

const options = { gfm: true, allowHtml: true, lazyImages: false }
describe('GFM boundary regressions', () => {
  it.each(['# heading', '> quote', '- item', '1. item', '```js\nx\n```', '<div>raw</div>', '---'])(
    'ends a table before %s', block => {
      const result = parse('| a | b |\n| - | - |\nrow\n' + block, options)
      expect(result).toContain('<td>row</td>\n<td></td>')
      expect(result.slice(result.indexOf('</table>') + 9)).toBe(parse(block, options))
    })
  it('keeps table-like lines inside an existing table', () => {
    const result = parse('| a | b |\n| - | - |\n| c | d |\n| - | - |', options)
    expect(result.match(/<table>/g)).toHaveLength(1)
    expect(result).toContain('<td>-</td>')
  })
  it('pads table rows under the token budget', () => {
    expect(() => parse('| a | b |\n| - | - |\n' + 'row\n'.repeat(25_000), { ...options, ugc: true })).toThrow(RangeError)
  })
  it.each(['~~~word~~~', '~~word~', '~word~~', '~ word~', '~word ~', '~~ word~~', '~~word ~~'])(
    'keeps invalid strikethrough literal: %s', source => {
      expect(parse(source, options)).not.toContain('<del>')
    })
  it('ignores escaped and code-span tilde closers', () => {
    expect(parse('~a \\~ b~', options)).toBe('<p><del>a ~ b</del></p>\n')
    expect(parse('~~a `~~` b~~', options)).toBe('<p><del>a <code>~~</code> b</del></p>\n')
  })
  it('keeps code spans and raw attributes outside email autolinking', () => {
    expect(parse('`foo@bar.com` <span title="foo@bar.com">x</span>', options))
      .toBe('<p><code>foo@bar.com</code> <span title="foo@bar.com">x</span></p>\n')
  })
  it('keeps explicit links around email and URL labels', () => {
    expect(parse('[foo@bar.com](https://target.test) [https://other.test](https://target.test)', options))
      .toBe('<p><a href="https://target.test">foo@bar.com</a> <a href="https://target.test">https://other.test</a></p>\n')
    expect(parse('[~foo@bar.com~][id]\n\n[id]: /target', options))
      .toBe('<p><a href="/target"><del>foo@bar.com</del></a></p>\n')
  })
  it('supports underscores at the start of email local parts', () => {
    expect(parse('_foo@bar.com', options)).toBe('<p><a href="mailto:_foo@bar.com">_foo@bar.com</a></p>\n')
  })
  it('preserves email token source and custom rule priority', () => {
    const source = 'Contact a.b-c_d@example.com, mailto:foo@bar.com.'
    const tokenizer = new InlineTokenizer([], options)
    expect(tokenizer.tokenize(source).map(t => t.raw).join('')).toBe(source)
    const custom = new InlineTokenizer([{ name: 'contact', priority: 450, triggerChars: [102], tokenize(src) {
      return src.startsWith('foo@bar.com') ? { raw: 'foo@bar.com', token: { type: 'text', raw: 'foo@bar.com', text: 'custom' } } : null
    } }], options)
    expect(custom.tokenize('foo@bar.com')[0]).toMatchObject({ type: 'text', text: 'custom' })
  })
  it('retains email output and URL policy through the sanitizer', () => {
    expect(sanitize('foo@bar.com xmpp:foo@bar.com', { ...options, sanitize: true }))
      .toBe('<p><a href="mailto:foo@bar.com">foo@bar.com</a> xmpp:foo@bar.com</p>\n')
  })
  it.each(['title', 'textarea', 'style', 'xmp', 'iframe', 'noembed', 'noframes', 'script', 'plaintext'])(
    'filters opening and closing %s tags with case-insensitive boundaries', tag => {
      const source = `<div>\n<${tag.toUpperCase()} x>text</${tag}><${tag}-custom>x</${tag}-custom>\n</div>`
      const html = parse(source, options)
      expect(html).toContain(`&lt;${tag.toUpperCase()} x>text&lt;/${tag}>`)
      expect(html).toContain(`<${tag}-custom>x</${tag}-custom>`)
      expect(parse(source, { ...options, gfm: false })).toContain(`<${tag.toUpperCase()} x>`)
    })
  it('keeps GFM disabled and parser instances independent', () => {
    const enabled = createParser(options)
    const disabled = createParser({ ...options, gfm: false })
    for (let count = 0; count < 2; count++) {
      expect(enabled.parse('~x~ foo@bar.com')).toContain('<del>x</del> <a')
      expect(disabled.parse('~x~ foo@bar.com')).toBe('<p>~x~ foo@bar.com</p>\n')
    }
  })
})
