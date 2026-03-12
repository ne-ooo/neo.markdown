import { describe, it, expect } from 'vitest'
import { parse } from '../../src/index.js'

describe('XSS Protection', () => {
  describe('HTML Escaping (Default Safe Mode)', () => {
    it('should escape script tags in text', () => {
      const result = parse('<script>alert("XSS")</script>')
      expect(result).not.toContain('<script>')
      expect(result).toContain('&lt;script&gt;')
      expect(result).toContain('&lt;/script&gt;')
    })

    it('should escape HTML tags in paragraphs', () => {
      const result = parse('<div>content</div>')
      expect(result).toContain('&lt;div&gt;')
      expect(result).toContain('&lt;/div&gt;')
    })

    it('should escape img tags', () => {
      const result = parse('<img src=x onerror=alert(1)>')
      expect(result).toContain('&lt;img')
    })

    it('should escape iframe tags', () => {
      const result = parse('<iframe src="javascript:alert(1)"></iframe>')
      expect(result).toContain('&lt;iframe')
    })

    it('should escape inline event handlers', () => {
      const result = parse('<a onclick="alert(1)">Click</a>')
      expect(result).toContain('&lt;a')
    })
  })

  describe('Dangerous Protocols', () => {
    it('should block javascript: in links', () => {
      const result = parse('[XSS](javascript:alert(1))')
      expect(result).not.toContain('javascript:')
      expect(result).not.toContain('<a href="javascript:')
    })

    it('should block javascript: in images', () => {
      const result = parse('![XSS](javascript:alert(1))')
      expect(result).not.toContain('javascript:')
      expect(result).not.toContain('<img src="javascript:')
    })

    it('should block data: URLs in links', () => {
      const result = parse('[XSS](data:text/html,<script>alert(1)</script>)')
      expect(result).not.toContain('data:')
    })

    it('should block data: URLs in images', () => {
      const result = parse('![XSS](data:text/html,<script>alert(1)</script>)')
      expect(result).not.toContain('data:')
    })

    it('should block vbscript: URLs', () => {
      const result = parse('[XSS](vbscript:alert(1))')
      expect(result).not.toContain('vbscript:')
    })
  })

  describe('Code Blocks - Safe Escaping', () => {
    it('should escape HTML in code blocks', () => {
      const result = parse('```\n<script>alert(1)</script>\n```')
      expect(result).toContain('&lt;script&gt;')
      expect(result).not.toContain('<script>alert')
    })

    it('should escape HTML in inline code', () => {
      const result = parse('Use `<script>alert(1)</script>` carefully')
      expect(result).toContain('&lt;script&gt;')
      expect(result).not.toContain('<script>alert')
    })
  })

  describe('Attribute Injection', () => {
    it('should escape quotes in link titles', () => {
      const result = parse('[Link](https://example.com "Title with \\"quotes\\"")')
      expect(result).toContain('&quot;')
    })

    it('should escape quotes in image titles', () => {
      const result = parse('![Alt](https://example.com/img.png "Title with \\"quotes\\"")')
      expect(result).toContain('&quot;')
    })
  })

  describe('Raw HTML (allowHtml: true)', () => {
    it('should allow HTML when allowHtml is true', () => {
      const result = parse('<div>content</div>', { allowHtml: true })
      expect(result).toContain('<div>content</div>')
    })

    it('should not escape HTML blocks when allowHtml is true', () => {
      const result = parse('<script>alert("test")</script>', { allowHtml: true })
      expect(result).toContain('<script>')
    })

    it('should still escape text content', () => {
      const result = parse('Normal text with <tags>', { allowHtml: true })
      expect(result).toContain('&lt;tags&gt;')
    })
  })

  describe('Advanced XSS Vectors (Phase 5)', () => {
    it('should escape mixed case script tags', () => {
      const result = parse('<ScRiPt>alert(1)</sCrIpT>')
      expect(result).toContain('&lt;')
      expect(result).not.toContain('<ScRiPt>')
    })

    it('should escape null bytes in URLs', () => {
      const result = parse('[Link](javascript\x00:alert(1))')
      expect(result).not.toContain('javascript')
    })

    it('should escape HTML entities in URLs', () => {
      const result = parse('[Link](javascript&#58;alert(1))')
      // The URL should be escaped or blocked
      expect(result).not.toContain('javascript&#58;')
    })

    it('should block file: protocol', () => {
      const result = parse('[File](file:///etc/passwd)')
      expect(result).not.toContain('file://')
    })

    it('should handle URL with spaces', () => {
      const result = parse('[Link](java script:alert(1))')
      // Should not create a valid link with javascript
      const hasJavaScriptHref = result.includes('href="java script:')
      expect(hasJavaScriptHref).toBe(false)
    })

    it('should escape HTML comments', () => {
      const result = parse('<!-- comment -->')
      expect(result).toContain('&lt;!--')
      expect(result).toContain('--&gt;')
    })

    it('should escape CDATA sections', () => {
      const result = parse('<![CDATA[content]]>')
      expect(result).toContain('&lt;![CDATA[')
    })

    it('should escape SVG with script', () => {
      const result = parse('<svg><script>alert(1)</script></svg>')
      expect(result).toContain('&lt;svg&gt;')
      expect(result).toContain('&lt;script&gt;')
    })

    it('should escape event handlers in markdown syntax', () => {
      // Even though this is markdown syntax, malicious attributes shouldn't work
      const result = parse('![alt" onerror="alert(1)](test.jpg)')
      // The onerror is in alt text, which gets escaped
      expect(result).toContain('&quot;')
      // Should not have an executable onerror attribute
      expect(result).not.toContain('onerror="alert')
    })

    it('should escape style tags', () => {
      const result = parse('<style>body { background: url("javascript:alert(1)") }</style>')
      expect(result).toContain('&lt;style&gt;')
    })

    it('should escape meta tags', () => {
      const result = parse('<meta http-equiv="refresh" content="0;url=javascript:alert(1)">')
      expect(result).toContain('&lt;meta')
    })

    it('should escape object/embed tags', () => {
      const result = parse('<object data="javascript:alert(1)"></object>')
      expect(result).toContain('&lt;object')
    })

    it('should handle Unicode escapes in URLs', () => {
      const result = parse('[Link](\\u006aavascript:alert(1))')
      // Should not interpret Unicode escapes in URLs
      expect(result).not.toContain('javascript:')
    })

    it('should escape base64 data URLs in images', () => {
      const result = parse('![XSS](data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+)')
      expect(result).not.toContain('data:')
    })

    it('should prevent JavaScript in autolinks', () => {
      const result = parse('javascript:alert(1)')
      // Should be escaped as text, not turned into a link
      expect(result).not.toContain('<a href="javascript:')
    })
  })

  describe('Entity Encoding Edge Cases', () => {
    it('should handle multiple ampersands', () => {
      const result = parse('A && B && C')
      expect(result).toContain('&amp;&amp;')
    })

    it('should escape less-than and greater-than', () => {
      const result = parse('1 < 2 && 3 > 1')
      expect(result).toContain('&lt;')
      expect(result).toContain('&gt;')
    })

    it('should escape quotes in text', () => {
      const result = parse('He said "Hello" and she said \'Hi\'')
      expect(result).toContain('&quot;')
      expect(result).toContain('&#39;')
    })

    it('should handle nested quotes', () => {
      const result = parse('Nested "quotes \'inside\' quotes"')
      expect(result).toContain('&quot;')
      expect(result).toContain('&#39;')
    })
  })

  describe('Table XSS Protection', () => {
    it('should escape HTML in table cells', () => {
      const result = parse('| Header |\n| ------ |\n| <script>alert(1)</script> |')
      expect(result).toContain('&lt;script&gt;')
      expect(result).not.toContain('<script>alert')
    })

    it('should escape dangerous URLs in table cells', () => {
      const result = parse('| Link |\n| ---- |\n| [XSS](javascript:alert(1)) |')
      expect(result).not.toContain('javascript:')
    })
  })

  describe('Task List XSS Protection', () => {
    it('should escape HTML in task list items', () => {
      const result = parse('- [x] <script>alert(1)</script>')
      expect(result).toContain('&lt;script&gt;')
      expect(result).not.toContain('<script>alert')
    })

    it('should not allow malicious checkbox syntax', () => {
      const result = parse('- [x onclick="alert(1)"] Task')
      // Should not create a checkbox (pattern doesn't match)
      // and onclick should be escaped
      expect(result).not.toContain('<input')
      expect(result).toContain('&quot;')
    })
  })

  describe('Strikethrough XSS Protection', () => {
    it('should escape HTML in strikethrough', () => {
      const result = parse('~~<script>alert(1)</script>~~')
      expect(result).toContain('&lt;script&gt;')
      expect(result).not.toContain('<script>alert')
    })
  })

  describe('Protocol Variants', () => {
    it('should block about: protocol', () => {
      const result = parse('[Link](about:blank)')
      expect(result).not.toContain('about:')
    })

    it('should block blob: protocol', () => {
      const result = parse('[Link](blob:http://example.com)')
      expect(result).not.toContain('blob:')
    })

    it('should allow safe protocols', () => {
      const result = parse('[Link](https://example.com)')
      expect(result).toContain('href="https://example.com"')
    })

    it('should allow mailto: protocol', () => {
      const result = parse('[Email](mailto:test@example.com)')
      expect(result).toContain('href="mailto:test@example.com"')
    })

    it('should allow tel: protocol', () => {
      const result = parse('[Phone](tel:+1234567890)')
      expect(result).toContain('href="tel:+1234567890"')
    })
  })
})
