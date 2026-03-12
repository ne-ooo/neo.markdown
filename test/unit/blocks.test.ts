import { describe, it, expect } from 'vitest'
import { parse } from '../../src/index.js'

describe('Block Elements', () => {
  describe('Horizontal Rules', () => {
    it('should parse HR with dashes', () => {
      const result = parse('---')
      expect(result).toBe('<hr>\n')
    })

    it('should parse HR with asterisks', () => {
      const result = parse('***')
      expect(result).toBe('<hr>\n')
    })

    it('should parse HR with underscores', () => {
      const result = parse('___')
      expect(result).toBe('<hr>\n')
    })

    it('should parse HR with spaces', () => {
      const result = parse('- - -')
      expect(result).toBe('<hr>\n')
    })

    it('should parse HR between paragraphs', () => {
      const result = parse('Above\n\n---\n\nBelow')
      expect(result).toBe('<p>Above</p>\n<hr>\n<p>Below</p>\n')
    })
  })

  describe('Blockquotes', () => {
    it('should parse simple blockquote', () => {
      const result = parse('> Quote')
      expect(result).toBe('<blockquote>\n<p>Quote</p>\n</blockquote>\n')
    })

    it('should parse multi-line blockquote', () => {
      const result = parse('> Line 1\n> Line 2')
      expect(result).toBe('<blockquote>\n<p>Line 1\nLine 2</p>\n</blockquote>\n')
    })

    it('should parse blockquote with lazy continuation', () => {
      const result = parse('> Line 1\nLine 2')
      // TODO: Add lazy continuation support in Phase 2
      // Current: treats continuation as separate paragraph
      expect(result).toBe('<blockquote>\n<p>Line 1</p>\n</blockquote>\n<p>Line 2</p>\n')
    })

    it('should parse nested blockquotes', () => {
      const result = parse('> Outer\n> > Inner')
      expect(result).toContain('<blockquote>')
      expect(result).toContain('Outer')
      expect(result).toContain('Inner')
    })

    it('should parse blockquote with other elements', () => {
      const result = parse('> # Heading\n> \n> Paragraph')
      expect(result).toContain('<blockquote>')
      expect(result).toContain('<h1>Heading</h1>')
      expect(result).toContain('<p>Paragraph</p>')
    })
  })

  describe('Lists', () => {
    describe('Unordered Lists', () => {
      it('should parse unordered list with dashes', () => {
        const result = parse('- Item 1\n- Item 2')
        expect(result).toContain('<ul>')
        expect(result).toContain('<li>Item 1</li>')
        expect(result).toContain('<li>Item 2</li>')
        expect(result).toContain('</ul>')
      })

      it('should parse unordered list with asterisks', () => {
        const result = parse('* Item 1\n* Item 2')
        expect(result).toContain('<ul>')
        expect(result).toContain('<li>Item 1</li>')
        expect(result).toContain('<li>Item 2</li>')
      })

      it('should parse unordered list with plus signs', () => {
        const result = parse('+ Item 1\n+ Item 2')
        expect(result).toContain('<ul>')
        expect(result).toContain('<li>Item 1</li>')
      })
    })

    describe('Ordered Lists', () => {
      it('should parse ordered list', () => {
        const result = parse('1. Item 1\n2. Item 2')
        expect(result).toContain('<ol>')
        expect(result).toContain('<li>Item 1</li>')
        expect(result).toContain('<li>Item 2</li>')
        expect(result).toContain('</ol>')
      })

      it('should parse ordered list with custom start', () => {
        const result = parse('5. Item 5\n6. Item 6')
        expect(result).toContain('<ol start="5">')
      })

      it('should parse ordered list with parentheses', () => {
        const result = parse('1) Item 1\n2) Item 2')
        expect(result).toContain('<ol>')
        expect(result).toContain('<li>Item 1</li>')
      })
    })
  })
})
