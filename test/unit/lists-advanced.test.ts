import { describe, it, expect } from 'vitest'
import { parse } from '../../src/index.js'

describe('Advanced Lists (Phase 2)', () => {
  describe('Nested Lists', () => {
    it('should parse nested unordered list', () => {
      const result = parse('- Item 1\n  - Nested 1\n  - Nested 2\n- Item 2')
      expect(result).toContain('<ul>')
      expect(result).toContain('Item 1')
      expect(result).toContain('Nested 1')
      expect(result).toContain('Nested 2')
      expect(result).toContain('Item 2')
    })

    it('should parse nested ordered list', () => {
      const result = parse('1. Item 1\n   1. Nested 1\n   2. Nested 2\n2. Item 2')
      expect(result).toContain('<ol>')
      expect(result).toContain('Item 1')
      expect(result).toContain('Nested 1')
      expect(result).toContain('Nested 2')
      expect(result).toContain('Item 2')
    })

    it('should parse mixed nested lists (ul in ol)', () => {
      // Phase 3: Fixed! Mixed nested lists now work
      const result = parse('1. Ordered item\n   - Unordered nested\n   - Another nested\n2. Second ordered')
      expect(result).toContain('<ol>')
      expect(result).toContain('<ul>')
      expect(result).toContain('Ordered item')
      expect(result).toContain('Unordered nested')
    })

    it('should parse mixed nested lists (ol in ul)', () => {
      // Phase 3: Fixed! Mixed nested lists now work
      const result = parse('- Unordered item\n  1. Ordered nested\n  2. Another nested\n- Second unordered')
      expect(result).toContain('<ul>')
      expect(result).toContain('<ol>')
      expect(result).toContain('Unordered item')
      expect(result).toContain('Ordered nested')
    })

    it('should parse deeply nested lists (3 levels)', () => {
      const result = parse('- Level 1\n  - Level 2\n    - Level 3\n  - Back to level 2')
      expect(result).toContain('Level 1')
      expect(result).toContain('Level 2')
      expect(result).toContain('Level 3')
      expect(result).toContain('Back to level 2')
    })
  })

  describe('List Items with Multiple Blocks', () => {
    it('should parse list item with multiple paragraphs', () => {
      const result = parse('- First paragraph\n\n  Second paragraph\n\n- Next item')
      expect(result).toContain('First paragraph')
      expect(result).toContain('Second paragraph')
      expect(result).toContain('Next item')
    })

    it('should parse list item with code block', () => {
      const result = parse('- Item with code:\n\n  ```\n  code here\n  ```\n\n- Next item')
      expect(result).toContain('Item with code')
      expect(result).toContain('<pre><code>')
      expect(result).toContain('code here')
    })

    it('should parse list item with blockquote', () => {
      const result = parse('- Item with quote:\n\n  > Quote here\n\n- Next item')
      expect(result).toContain('Item with quote')
      expect(result).toContain('<blockquote>')
      expect(result).toContain('Quote here')
    })
  })

  describe('Tight vs Loose Lists', () => {
    it('should render tight list without <p> tags', () => {
      const result = parse('- Item 1\n- Item 2\n- Item 3')
      expect(result).not.toContain('<p>')
      expect(result).toContain('<li>Item 1</li>')
      expect(result).toContain('<li>Item 2</li>')
    })

    it('should render loose list with <p> tags', () => {
      const result = parse('- Item 1\n\n- Item 2\n\n- Item 3')
      expect(result).toContain('<p>Item 1</p>')
      expect(result).toContain('<p>Item 2</p>')
      expect(result).toContain('<p>Item 3</p>')
    })
  })
})
