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
})
