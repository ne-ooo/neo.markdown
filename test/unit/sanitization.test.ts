import { describe, it, expect } from 'vitest'
import { createParser as createUnsanitizedParser } from '../../src/index.js'
import { createParser, sanitizeHtml } from '../../src/sanitized.js'
import { buildSanitizerConfig, DEFAULT_ALLOWED_TAGS, DEFAULT_ALLOWED_ATTRIBUTES } from '../../src/core/sanitizer.js'

/**
 * Helper: parse markdown with allowHtml + sanitize enabled
 */
function sanitizedParse(md: string, extra: Record<string, unknown> = {}) {
  const parser = createParser({ allowHtml: true, sanitize: true, ...extra })
  return parser.parse(md)
}

/**
 * Helper: test the sanitizer directly on HTML strings
 */
function sanitize(html: string, extra: { allowedTags?: string[]; allowedAttributes?: Record<string, string[]>; allowStyle?: boolean } = {}) {
  const config = buildSanitizerConfig(extra)
  return sanitizeHtml(html, config)
}

describe('HTML sanitization', () => {
  describe('sanitizer unit tests (direct HTML input)', () => {
    describe('script injection', () => {
      it('strips <script> tags and content entirely', () => {
        const html = sanitize('<script>alert("xss")</script>')
        expect(html).not.toContain('<script>')
        expect(html).not.toContain('alert')
      })

      it('strips <script> with attributes', () => {
        expect(sanitize('<script src="evil.js"></script>')).not.toContain('<script')
      })

      it('strips case-insensitive <SCRIPT>', () => {
        expect(sanitize('<SCRIPT>alert(1)</SCRIPT>')).not.toContain('alert')
      })

      it('strips mixed case <ScRiPt>', () => {
        expect(sanitize('<ScRiPt>alert(1)</ScRiPt>')).not.toContain('alert')
      })
    })

    describe('event handler stripping', () => {
      it('strips onerror from img', () => {
        const html = sanitize('<img onerror="alert(1)" src="x">')
        expect(html).not.toContain('onerror')
        expect(html).toContain('<img')
        expect(html).toContain('src="x"')
      })

      it('strips onclick from any tag', () => {
        const html = sanitize('<a href="#" onclick="alert(1)">click</a>')
        expect(html).not.toContain('onclick')
        expect(html).toContain('<a')
        expect(html).toContain('href="#"')
      })

      it('strips onload', () => {
        const html = sanitize('<img src="x" onload="alert(1)">')
        expect(html).not.toContain('onload')
      })

      it('strips onmouseover', () => {
        const html = sanitize('<div onmouseover="alert(1)">hover</div>')
        expect(html).not.toContain('onmouseover')
        expect(html).toContain('<div>')
      })

      it('strips case-insensitive ONERROR', () => {
        const html = sanitize('<img src="x" ONERROR="alert(1)">')
        expect(html).not.toContain('ONERROR')
        expect(html).not.toContain('onerror')
      })
    })

    describe('dangerous URL protocols', () => {
      it('strips javascript: href', () => {
        const html = sanitize('<a href="javascript:alert(1)">click</a>')
        expect(html).not.toContain('javascript:')
      })

      it('strips case-insensitive jaVaScRiPt:', () => {
        const html = sanitize('<a href="jaVaScRiPt:alert(1)">click</a>')
        expect(html).not.toContain('javascript')
      })

      it('strips data: href', () => {
        const html = sanitize('<a href="data:text/html,<script>alert(1)</script>">click</a>')
        expect(html).not.toContain('data:')
      })

      it('strips vbscript: href', () => {
        const html = sanitize('<a href="vbscript:alert(1)">click</a>')
        expect(html).not.toContain('vbscript:')
      })

      it('strips javascript: with leading whitespace', () => {
        const html = sanitize('<a href=" javascript:alert(1)">click</a>')
        expect(html).not.toContain('javascript')
      })

      it('strips entity-encoded javascript: protocol', () => {
        const html = sanitize('<a href="&#106;avascript:alert(1)">click</a>')
        expect(html).not.toContain('javascript')
      })

      it('strips javascript with an entity-encoded colon', () => {
        const html = sanitize('<a href="javascript&colon;alert(1)">click</a>')
        expect(html).not.toContain('href=')
      })

      it('strips javascript with encoded URL whitespace', () => {
        const newline = sanitize('<a href="java&#10;script:alert(1)">click</a>')
        const tab = sanitize('<a href="java&#9;script:alert(1)">click</a>')
        expect(newline).not.toContain('href=')
        expect(tab).not.toContain('href=')
      })

      it('does not throw on oversized numeric entities', () => {
        const decimalEntity = `&#${'9'.repeat(500)};`
        const hexadecimalEntity = `&#x${'f'.repeat(500)};`

        expect(() => sanitize(`<a href="${decimalEntity}">decimal</a>`)).not.toThrow()
        expect(() => sanitize(`<a href="${hexadecimalEntity}">hexadecimal</a>`)).not.toThrow()
      })

      it('allows safe protocols', () => {
        expect(sanitize('<a href="https://example.com">safe</a>')).toContain('href="https://example.com"')
        expect(sanitize('<a href="http://example.com">safe</a>')).toContain('href="http://example.com"')
        expect(sanitize('<a href="mailto:user@example.com">email</a>')).toContain('href="mailto:user@example.com"')
        expect(sanitize('<a href="tel:+1234567890">call</a>')).toContain('href="tel:+1234567890"')
      })

      it('allows anchor links', () => {
        expect(sanitize('<a href="#section">anchor</a>')).toContain('href="#section"')
      })

      it('allows relative paths', () => {
        expect(sanitize('<a href="/path/to/page">link</a>')).toContain('href="/path/to/page"')
      })
    })

    describe('always-blocked tags', () => {
      it('strips <iframe>', () => {
        expect(sanitize('<iframe src="evil.com"></iframe>')).not.toContain('<iframe')
      })

      it('strips <object>', () => {
        expect(sanitize('<object data="evil.swf"></object>')).not.toContain('<object')
      })

      it('strips <embed>', () => {
        expect(sanitize('<embed src="evil.swf">')).not.toContain('<embed')
      })

      it('strips <form>', () => {
        const html = sanitize('<form action="evil.com"><input></form>')
        expect(html).not.toContain('<form')
        expect(html).not.toContain('<input')
      })

      it('strips <style> and content', () => {
        const html = sanitize('<style>body { display: none }</style>')
        expect(html).not.toContain('<style')
        expect(html).not.toContain('display')
      })

      it('strips <meta>', () => {
        expect(sanitize('<meta http-equiv="refresh" content="0;url=evil.com">')).not.toContain('<meta')
      })

      it('strips <base>', () => {
        expect(sanitize('<base href="evil.com">')).not.toContain('<base')
      })

      it('strips <svg>', () => {
        expect(sanitize('<svg><script>alert(1)</script></svg>')).not.toContain('<svg')
      })

      it('strips <math>', () => {
        expect(sanitize('<math><script>alert(1)</script></math>')).not.toContain('<math')
      })
    })

    describe('allowed tags preserved', () => {
      it('preserves <p>', () => {
        expect(sanitize('<p>Hello</p>')).toContain('<p>')
      })

      it('preserves <strong> and <em>', () => {
        const html = sanitize('<strong>bold</strong> and <em>italic</em>')
        expect(html).toContain('<strong>')
        expect(html).toContain('<em>')
      })

      it('preserves <a> with safe href', () => {
        expect(sanitize('<a href="https://example.com">link</a>')).toContain('<a href="https://example.com">')
      })

      it('preserves <img> with safe src', () => {
        const html = sanitize('<img src="https://example.com/img.png" alt="photo">')
        expect(html).toContain('<img')
        expect(html).toContain('src="https://example.com/img.png"')
        expect(html).toContain('alt="photo"')
      })

      it('preserves <details> and <summary>', () => {
        const html = sanitize('<details><summary>Click</summary>Content</details>')
        expect(html).toContain('<details>')
        expect(html).toContain('<summary>')
      })

      it('preserves <table> structure', () => {
        const html = sanitize('<table><thead><tr><th>A</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>')
        expect(html).toContain('<table>')
        expect(html).toContain('<th>A</th>')
        expect(html).toContain('<td>1</td>')
      })

      it('preserves <code> with class for language detection', () => {
        expect(sanitize('<code class="language-js">const x = 1</code>')).toContain('class="language-js"')
      })

      it('preserves heading tags', () => {
        const html = sanitize('<h1>Title</h1><h2>Subtitle</h2>')
        expect(html).toContain('<h1>')
        expect(html).toContain('<h2>')
      })

      it('preserves list tags', () => {
        const html = sanitize('<ul><li>Item</li></ul>')
        expect(html).toContain('<ul>')
        expect(html).toContain('<li>')
      })

      it('preserves <blockquote>', () => {
        expect(sanitize('<blockquote>Quote</blockquote>')).toContain('<blockquote>')
      })
    })

    describe('attribute handling', () => {
      it('strips srcdoc attribute', () => {
        expect(sanitize('<p srcdoc="evil">text</p>')).not.toContain('srcdoc')
      })

      it('strips formaction attribute', () => {
        expect(sanitize('<p formaction="evil.com">text</p>')).not.toContain('formaction')
      })

      it('strips style attribute by default', () => {
        expect(sanitize('<div style="color:red">text</div>')).not.toContain('style=')
      })

      it('allows style when allowStyle: true', () => {
        expect(sanitize('<div style="color: red">text</div>', { allowStyle: true })).toContain('style="color:red"')
      })

      it('restricts allowStyle to non-layout properties and safe values', () => {
        const html = sanitize(
          '<div style="color:red;position:fixed;inset:0;width:100vw;background-image:url(https://evil.example/x);z-index:999999">text</div>',
          { allowStyle: true }
        )

        expect(html).toContain('color:red')
        expect(html).not.toContain('position')
        expect(html).not.toContain('inset')
        expect(html).not.toContain('width')
        expect(html).not.toContain('url(')
        expect(html).not.toContain('z-index')
      })

      it('removes CSS expressions and external URLs from allowed properties', () => {
        const expression = sanitize(
          '<div style="color:expression(alert(1))">text</div>',
          { allowStyle: true }
        )
        const externalUrl = sanitize(
          '<div style="background-color:url(https://evil.example/x)">text</div>',
          { allowStyle: true }
        )

        expect(expression).not.toContain('expression')
        expect(externalUrl).not.toContain('url(')
      })

      it('preserves aria-* attributes', () => {
        expect(sanitize('<div aria-label="description">text</div>')).toContain('aria-label="description"')
      })

      it('preserves data-* attributes', () => {
        expect(sanitize('<div data-id="123">text</div>')).toContain('data-id="123"')
      })

      it('preserves role attribute', () => {
        expect(sanitize('<div role="button">text</div>')).toContain('role="button"')
      })

      it('preserves title attribute', () => {
        expect(sanitize('<p title="tooltip">text</p>')).toContain('title="tooltip"')
      })

      it('preserves td/th alignment', () => {
        expect(sanitize('<td align="center">text</td>')).toContain('align="center"')
      })

      it('preserves ol start and type', () => {
        const html = sanitize('<ol start="5" type="a"><li>item</li></ol>')
        expect(html).toContain('start="5"')
        expect(html).toContain('type="a"')
      })

      it('preserves img loading attribute', () => {
        expect(sanitize('<img src="photo.jpg" loading="lazy">')).toContain('loading="lazy"')
      })
    })

    describe('nested dangerous content', () => {
      it('strips script inside div', () => {
        const html = sanitize('<div><script>alert(1)</script></div>')
        expect(html).not.toContain('<script')
        expect(html).not.toContain('alert')
        expect(html).toContain('<div>')
      })

      it('strips nested dangerous tags deep inside', () => {
        const html = sanitize('<div><p><span><script>evil</script></span></p></div>')
        expect(html).not.toContain('<script')
        expect(html).toContain('<div>')
        expect(html).toContain('<p>')
        expect(html).toContain('<span>')
      })
    })

    describe('entity-encoded bypass attempts', () => {
      it('handles entity-encoded angle brackets', () => {
        const html = sanitize('&#60;script&#62;alert(1)&#60;/script&#62;')
        expect(html).not.toContain('<script')
        expect(html).toBe('&lt;script&gt;alert(1)&lt;/script&gt;')
      })

      it('handles hex-encoded angle brackets', () => {
        const html = sanitize('&#x3c;script&#x3e;alert(1)&#x3c;/script&#x3e;')
        expect(html).not.toContain('<script')
      })
    })

    describe('HTML comments', () => {
      it('strips HTML comments', () => {
        const html = sanitize('<!-- comment --><p>text</p>')
        expect(html).not.toContain('<!--')
        expect(html).toContain('<p>')
      })

      it('strips comments containing script', () => {
        expect(sanitize('<!-- <script>alert(1)</script> -->')).not.toContain('script')
      })
    })

    describe('split-tag bypass', () => {
      it('handles split <scr<script>ipt> bypass attempt', () => {
        const html = sanitize('<scr<script>ipt>alert(1)</scr</script>ipt>')
        expect(html).not.toContain('<script')
      })
    })

    describe('custom allowedTags', () => {
      it('extends defaults with additional tags', () => {
        const html = sanitize('<custom-tag>content</custom-tag>', { allowedTags: ['custom-tag'] })
        expect(html).toContain('<custom-tag>')
      })

      it('cannot override always-blocked tags', () => {
        const html = sanitize('<script>alert(1)</script>', { allowedTags: ['script'] })
        expect(html).not.toContain('<script')
      })
    })

    describe('custom allowedAttributes', () => {
      it('extends defaults with additional tag attributes', () => {
        const html = sanitize('<div custom-attr="value">text</div>', {
          allowedAttributes: { div: ['custom-attr'] },
        })
        expect(html).toContain('custom-attr="value"')
      })
    })
  })

  describe('integration with markdown parser', () => {
    it('requires an explicit sanitizer provider from the main entry', () => {
      expect(() => createUnsanitizedParser({ allowHtml: true, sanitize: true })).toThrow(
        'HTML sanitization requires a sanitizer provider'
      )
    })

    it('accepts a custom sanitizer provider in the main entry', () => {
      const parser = createUnsanitizedParser({
        allowHtml: true,
        sanitize: true,
        sanitizer: () => '<p>custom sanitizer</p>',
      })

      expect(parser.parse('<script>alert(1)</script>')).toBe('<p>custom sanitizer</p>')
    })

    it('strips script block in markdown', () => {
      const html = sanitizedParse('<script>alert("xss")</script>')
      expect(html).not.toContain('<script')
      expect(html).not.toContain('alert')
    })

    it('sanitizes tokenized input passed to the public render method', () => {
      const parser = createParser({ allowHtml: true, sanitize: true })
      const markdown = '<script>alert("xss")</script>\n\n<p>safe</p>'
      const rendered = parser.render(parser.tokenize(markdown))

      expect(rendered).toBe(parser.parse(markdown))
      expect(rendered).not.toContain('<script')
      expect(rendered).not.toContain('alert')
      expect(rendered).toContain('<p>safe</p>')
    })

    it('preserves markdown-generated HTML through sanitization', () => {
      const md = '# Title\n\n**bold** and *italic*\n\n- list item\n\n```js\ncode\n```'
      const html = sanitizedParse(md)
      expect(html).toContain('<h1>')
      expect(html).toContain('<strong>')
      expect(html).toContain('<em>')
      expect(html).toContain('<ul>')
      expect(html).toContain('<pre>')
      expect(html).toContain('<code')
    })

    it('preserves generated disabled task-list checkboxes', () => {
      const html = sanitizedParse('- [x] done', { gfm: true })
      expect(html).toContain('<input')
      expect(html).toContain('type="checkbox"')
      expect(html).toContain('disabled')
      expect(html).toContain('checked')
    })

    it('removes user-authored interactive inputs', () => {
      const html = sanitizedParse('<input type="text" value="secret">')
      expect(html).not.toContain('<input')
    })

    it('strips script from mixed markdown and HTML', () => {
      const md = '# Title\n\n<script>alert("xss")</script>\n\nSafe paragraph.'
      const html = sanitizedParse(md)
      expect(html).toContain('<h1>Title</h1>')
      expect(html).not.toContain('<script')
      expect(html).toContain('Safe paragraph')
    })

    it('preserves block-level div with allowed attributes', () => {
      const html = sanitizedParse('<div class="note" role="alert">\n\nThis is a note.\n\n</div>')
      expect(html).toContain('<div')
      expect(html).toContain('class="note"')
      expect(html).toContain('role="alert"')
    })

    it('strips div event handlers in markdown', () => {
      const html = sanitizedParse('<div onclick="alert(1)">\n\nContent\n\n</div>')
      expect(html).not.toContain('onclick')
      expect(html).toContain('<div>')
    })

    it('sanitize: false (default) — no sanitization', () => {
      const parser = createParser({ allowHtml: true, sanitize: false })
      const html = parser.parse('<script>alert("xss")</script>')
      expect(html).toContain('script')
    })

    it('does not sanitize when allowHtml is false (escaped instead)', () => {
      const parser = createParser({ allowHtml: false, sanitize: true })
      const html = parser.parse('<script>alert("xss")</script>')
      expect(html).toContain('&lt;script&gt;')
    })
  })

  describe('exported defaults', () => {
    it('DEFAULT_ALLOWED_TAGS contains expected tags', () => {
      expect(DEFAULT_ALLOWED_TAGS.has('p')).toBe(true)
      expect(DEFAULT_ALLOWED_TAGS.has('a')).toBe(true)
      expect(DEFAULT_ALLOWED_TAGS.has('img')).toBe(true)
      expect(DEFAULT_ALLOWED_TAGS.has('table')).toBe(true)
      expect(DEFAULT_ALLOWED_TAGS.has('code')).toBe(true)
      expect(DEFAULT_ALLOWED_TAGS.has('script')).toBe(false)
      expect(DEFAULT_ALLOWED_TAGS.has('iframe')).toBe(false)
    })

    it('DEFAULT_ALLOWED_ATTRIBUTES has per-tag attrs', () => {
      expect(DEFAULT_ALLOWED_ATTRIBUTES['a']?.has('href')).toBe(true)
      expect(DEFAULT_ALLOWED_ATTRIBUTES['img']?.has('src')).toBe(true)
      expect(DEFAULT_ALLOWED_ATTRIBUTES['img']?.has('alt')).toBe(true)
      expect(DEFAULT_ALLOWED_ATTRIBUTES['td']?.has('colspan')).toBe(true)
    })
  })
})
