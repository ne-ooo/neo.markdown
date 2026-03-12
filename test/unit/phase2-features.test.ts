import { describe, it, expect } from 'vitest'
import { parse } from '../../src/index.js'

describe('Phase 2 Features', () => {
  describe('Setext Headings', () => {
    it('should parse Setext h1 with ===', () => {
      const result = parse('Heading 1\n=========')
      expect(result).toBe('<h1>Heading 1</h1>\n')
    })

    it('should parse Setext h2 with ---', () => {
      const result = parse('Heading 2\n---------')
      expect(result).toBe('<h2>Heading 2</h2>\n')
    })

    it('should parse Setext h1 with minimal ===', () => {
      const result = parse('Heading\n=')
      expect(result).toBe('<h1>Heading</h1>\n')
    })

    it('should parse Setext h2 with minimal ---', () => {
      const result = parse('Heading\n-')
      expect(result).toBe('<h2>Heading</h2>\n')
    })

    it('should parse Setext heading with inline emphasis', () => {
      const result = parse('**Bold** Heading\n================')
      expect(result).toBe('<h1><strong>Bold</strong> Heading</h1>\n')
    })

    it('should distinguish Setext h2 from HR', () => {
      const markdown = 'Heading\n---\n\n---'
      const result = parse(markdown)
      expect(result).toContain('<h2>Heading</h2>')
      expect(result).toContain('<hr>')
    })
  })

  describe('Indented Code Blocks', () => {
    it('should parse 4-space indented code block', () => {
      const result = parse('    code line 1\n    code line 2')
      expect(result).toContain('<pre><code>')
      expect(result).toContain('code line 1')
      expect(result).toContain('code line 2')
    })

    it('should parse tab-indented code block', () => {
      const result = parse('\tcode here')
      expect(result).toContain('<pre><code>')
      expect(result).toContain('code here')
    })

    it('should preserve blank lines in indented code', () => {
      const result = parse('    line 1\n\n    line 3')
      expect(result).toContain('line 1')
      expect(result).toContain('line 3')
    })

    it('should parse indented code after paragraph', () => {
      const result = parse('Paragraph\n\n    code block')
      expect(result).toContain('<p>Paragraph</p>')
      expect(result).toContain('<pre><code>')
      expect(result).toContain('code block')
    })
  })

  describe('Lazy Continuation in Blockquotes', () => {
    it('should support lazy continuation', () => {
      const result = parse('> Line 1\nLine 2')
      expect(result).toContain('<blockquote>')
      expect(result).toContain('Line 1')
      expect(result).toContain('Line 2')
    })

    it('should support multi-line lazy continuation', () => {
      const result = parse('> Line 1\nLine 2\nLine 3')
      expect(result).toContain('Line 1')
      expect(result).toContain('Line 2')
      expect(result).toContain('Line 3')
    })

    it('should end lazy continuation at blank line', () => {
      const result = parse('> Quote line\nLazy line\n\nNew paragraph')
      expect(result).toContain('<blockquote>')
      expect(result).toContain('Quote line')
      expect(result).toContain('Lazy line')
      expect(result).toContain('<p>New paragraph</p>')
    })
  })
})
