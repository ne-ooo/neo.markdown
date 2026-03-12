import { describe, it, expect } from 'vitest'
import { parse } from '../../src/index.js'

describe('Links and Images', () => {
  describe('Links', () => {
    it('should parse simple link', () => {
      const result = parse('[Link](https://example.com)')
      expect(result).toBe('<p><a href="https://example.com">Link</a></p>\n')
    })

    it('should parse link with title', () => {
      const result = parse('[Link](https://example.com "Title")')
      expect(result).toBe('<p><a href="https://example.com" title="Title">Link</a></p>\n')
    })

    it('should parse link with emphasis in text', () => {
      const result = parse('[**Bold** Link](https://example.com)')
      expect(result).toBe('<p><a href="https://example.com"><strong>Bold</strong> Link</a></p>\n')
    })

    it('should escape HTML in link text', () => {
      const result = parse('[<script>](https://example.com)')
      expect(result).toBe('<p><a href="https://example.com">&lt;script&gt;</a></p>\n')
    })

    it('should escape HTML in link href', () => {
      const result = parse('[Link](<https://example.com?a=1&b=2>)')
      expect(result).toContain('href=')
    })

    it('should parse multiple links', () => {
      const result = parse('[First](https://first.com) and [Second](https://second.com)')
      expect(result).toBe('<p><a href="https://first.com">First</a> and <a href="https://second.com">Second</a></p>\n')
    })

    it('should handle link in heading', () => {
      const result = parse('# [Link](https://example.com)')
      expect(result).toBe('<h1><a href="https://example.com">Link</a></h1>\n')
    })

    it('should block javascript: URLs for security', () => {
      const result = parse('[XSS](javascript:alert(1))')
      expect(result).toBe('<p>XSS</p>\n')
    })

    it('should block data: URLs for security', () => {
      const result = parse('[XSS](data:text/html,<script>alert(1)</script>)')
      expect(result).toBe('<p>XSS</p>\n')
    })
  })

  describe('Images', () => {
    it('should parse simple image', () => {
      const result = parse('![Alt](https://example.com/image.png)')
      expect(result).toBe('<p><img src="https://example.com/image.png" alt="Alt"></p>\n')
    })

    it('should parse image with title', () => {
      const result = parse('![Alt](https://example.com/image.png "Title")')
      expect(result).toBe('<p><img src="https://example.com/image.png" alt="Alt" title="Title"></p>\n')
    })

    it('should parse image with empty alt text', () => {
      const result = parse('![](https://example.com/image.png)')
      expect(result).toBe('<p><img src="https://example.com/image.png" alt=""></p>\n')
    })

    it('should escape HTML in alt text', () => {
      const result = parse('![<script>](https://example.com/image.png)')
      expect(result).toContain('alt="&lt;script&gt;"')
    })

    it('should block javascript: URLs in images for security', () => {
      const result = parse('![XSS](javascript:alert(1))')
      expect(result).toBe('<p>XSS</p>\n')
    })

    it('should block data: URLs in images for security', () => {
      const result = parse('![XSS](data:text/html,<script>alert(1)</script>)')
      expect(result).toBe('<p>XSS</p>\n')
    })
  })
})
