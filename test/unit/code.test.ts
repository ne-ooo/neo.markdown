import { describe, it, expect } from 'vitest'
import { parse } from '../../src/index.js'

describe('Code', () => {
  describe('Inline Code', () => {
    it('should parse inline code', () => {
      const result = parse('Use `code` here')
      expect(result).toBe('<p>Use <code>code</code> here</p>\n')
    })

    it('should parse multiple inline code blocks', () => {
      const result = parse('`first` and `second`')
      expect(result).toBe('<p><code>first</code> and <code>second</code></p>\n')
    })

    it('should escape HTML in inline code', () => {
      const result = parse('Use `<script>` tag')
      expect(result).toBe('<p>Use <code>&lt;script&gt;</code> tag</p>\n')
    })

    it('should handle backticks inside code with double backticks', () => {
      const result = parse('``code with `backtick` inside``')
      expect(result).toBe('<p><code>code with `backtick` inside</code></p>\n')
    })

    it('should preserve spaces in inline code', () => {
      const result = parse('`  spaced  `')
      expect(result).toBe('<p><code>spaced</code></p>\n')
    })
  })

  describe('Code Blocks', () => {
    it('should parse fenced code block with backticks', () => {
      const result = parse('```\ncode here\n```')
      expect(result).toBe('<pre><code>code here</code></pre>\n')
    })

    it('should parse fenced code block with tildes', () => {
      const result = parse('~~~\ncode here\n~~~')
      expect(result).toBe('<pre><code>code here</code></pre>\n')
    })

    it('should parse code block with language', () => {
      const result = parse('```javascript\nconst x = 1\n```')
      expect(result).toBe('<pre><code class="language-javascript">const x = 1</code></pre>\n')
    })

    it('should parse code block with TypeScript language', () => {
      const result = parse('```typescript\nconst x: number = 1\n```')
      expect(result).toBe('<pre><code class="language-typescript">const x: number = 1</code></pre>\n')
    })

    it('should escape HTML in code blocks', () => {
      const result = parse('```\n<script>alert("xss")</script>\n```')
      expect(result).toBe('<pre><code>&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;</code></pre>\n')
    })

    it('should preserve blank lines in code blocks', () => {
      const result = parse('```\nline 1\n\nline 3\n```')
      expect(result).toBe('<pre><code>line 1\n\nline 3</code></pre>\n')
    })

    it('should handle code block after paragraph', () => {
      const result = parse('A paragraph\n\n```\ncode\n```')
      expect(result).toBe('<p>A paragraph</p>\n<pre><code>code</code></pre>\n')
    })

    it('should parse multiple code blocks', () => {
      const result = parse('```\nfirst\n```\n\n```\nsecond\n```')
      expect(result).toBe('<pre><code>first</code></pre>\n<pre><code>second</code></pre>\n')
    })
  })
})
