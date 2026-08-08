import { describe, it, expect } from 'vitest'
import { createParser } from '../../src/index.js'

describe('safeLinks option', () => {
  it('external link gets rel and target', () => {
    const parser = createParser({ safeLinks: true })
    const html = parser.parse('[link](https://example.com)')
    expect(html).toContain('rel="nofollow noopener noreferrer"')
    expect(html).toContain('target="_blank"')
  })

  it('anchor link is unchanged', () => {
    const parser = createParser({ safeLinks: true })
    const html = parser.parse('[section](#heading)')
    expect(html).not.toContain('rel=')
    expect(html).not.toContain('target=')
    expect(html).toContain('href="#heading"')
  })

  it('relative link is unchanged without baseUrl', () => {
    const parser = createParser({ safeLinks: true })
    const html = parser.parse('[doc](./docs/guide.md)')
    expect(html).not.toContain('rel=')
    expect(html).toContain('href="./docs/guide.md"')
  })

  it('relative link resolved with baseUrl', () => {
    const parser = createParser({
      safeLinks: {
        baseUrl: 'https://github.com/user/repo/blob/main',
      },
    })
    const html = parser.parse('[doc](./docs/guide.md)')
    expect(html).toContain('href="https://github.com/user/repo/blob/main/docs/guide.md"')
  })

  it('relative image resolved with baseUrl', () => {
    const parser = createParser({
      safeLinks: {
        baseUrl: 'https://github.com/user/repo/blob/main',
      },
    })
    const html = parser.parse('![screenshot](./images/screenshot.png)')
    expect(html).toContain('src="https://github.com/user/repo/blob/main/images/screenshot.png"')
  })

  it('custom externalRel overrides default', () => {
    const parser = createParser({
      safeLinks: { externalRel: 'noopener' },
    })
    const html = parser.parse('[link](https://example.com)')
    expect(html).toContain('rel="noopener"')
    expect(html).not.toContain('nofollow')
  })

  it('custom externalTarget overrides default', () => {
    const parser = createParser({
      safeLinks: { externalTarget: '_self' },
    })
    const html = parser.parse('[link](https://example.com)')
    expect(html).toContain('target="_self"')
  })

  it('safeLinks: false — no extra attributes', () => {
    const parser = createParser()
    const html = parser.parse('[link](https://example.com)')
    expect(html).not.toContain('rel=')
    expect(html).not.toContain('target=')
  })

  it('http:// links are treated as external', () => {
    const parser = createParser({ safeLinks: true })
    const html = parser.parse('[link](http://example.com)')
    expect(html).toContain('rel="nofollow noopener noreferrer"')
  })

  it('treats uppercase and protocol-relative HTTP URLs as external', () => {
    const parser = createParser({ safeLinks: true })
    expect(parser.parse('[upper](HTTPS://example.com)')).toContain('target="_blank"')
    expect(parser.parse('[relative](//example.com/path)')).toContain('target="_blank"')
  })

  it('escapes configuration-derived link attributes', () => {
    const parser = createParser({
      safeLinks: {
        externalRel: 'noopener" onclick="alert(1)',
        externalTarget: '_blank" autofocus="',
      },
    })
    const html = parser.parse('[link](https://example.com)')

    expect(html).not.toContain('" onclick=')
    expect(html).not.toContain('" autofocus=')
    expect(html).toContain('&quot; onclick=&quot;')
  })

  it('uses URL resolution for root-relative and parent paths', () => {
    const parser = createParser({
      safeLinks: { baseUrl: 'https://example.com/docs/guide' },
    })

    expect(parser.parse('[root](/assets/a.png)')).toContain('href="https://example.com/assets/a.png"')
    expect(parser.parse('[parent](../api.md)')).toContain('href="https://example.com/docs/api.md"')
  })

  it('does not throw on oversized numeric entities in URLs', () => {
    const parser = createParser({ safeLinks: true })
    const decimalEntity = `&#${'9'.repeat(500)};`
    const hexadecimalEntity = `&#x${'f'.repeat(500)};`

    expect(() => parser.parse(`[decimal](${decimalEntity})`)).not.toThrow()
    expect(() => parser.parse(`[hexadecimal](${hexadecimalEntity})`)).not.toThrow()
  })
})

describe('ugc shorthand', () => {
  it('enables safeLinks + sanitize + disables allowHtml', () => {
    const parser = createParser({ ugc: true })

    // safeLinks enabled
    const linkHtml = parser.parse('[link](https://example.com)')
    expect(linkHtml).toContain('rel="nofollow noopener noreferrer"')

    // allowHtml disabled (HTML is escaped)
    const scriptHtml = parser.parse('<script>alert("xss")</script>')
    expect(scriptHtml).toContain('&lt;script&gt;')
  })

  it('does not allow callers to override its security invariants', () => {
    const parser = createParser({
      ugc: true,
      allowHtml: true,
      sanitize: false,
      safeLinks: {
        externalRel: '',
        externalTarget: '_self',
      },
    })

    expect(parser.parse('<script>alert(1)</script>')).toContain('&lt;script&gt;')
    const link = parser.parse('[link](https://example.com)')
    expect(link).toContain('rel="nofollow noopener noreferrer"')
    expect(link).toContain('target="_blank"')
  })
})
