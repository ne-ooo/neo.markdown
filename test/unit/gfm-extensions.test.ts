import { describe, it, expect } from 'vitest'
import { parse } from '../../src/index.js'

describe('GFM Extensions (Phase 4)', () => {
  describe('Strikethrough', () => {
    it('should parse basic strikethrough', () => {
      const result = parse('~~strikethrough~~')
      expect(result).toBe('<p><del>strikethrough</del></p>\n')
    })

    it('should parse strikethrough in middle of text', () => {
      const result = parse('This is ~~deleted~~ text')
      expect(result).toBe('<p>This is <del>deleted</del> text</p>\n')
    })

    it('should parse multiple strikethrough sections', () => {
      const result = parse('~~First~~ and ~~Second~~')
      expect(result).toBe('<p><del>First</del> and <del>Second</del></p>\n')
    })

    it('should parse nested emphasis in strikethrough', () => {
      const result = parse('~~deleted **bold**~~')
      expect(result).toContain('<del>')
      expect(result).toContain('<strong>')
      expect(result).toContain('deleted')
      expect(result).toContain('bold')
    })

    it('should parse strikethrough with emphasis', () => {
      const result = parse('**bold ~~and deleted~~**')
      expect(result).toContain('<strong>')
      expect(result).toContain('<del>')
      expect(result).toContain('bold')
      expect(result).toContain('and deleted')
    })
  })

  describe('Task Lists', () => {
    it('should parse unchecked task list item', () => {
      const result = parse('- [ ] Unchecked task')
      expect(result).toBe('<ul>\n<li><input type="checkbox" disabled> Unchecked task</li>\n</ul>\n')
    })

    it('should parse checked task list item (lowercase x)', () => {
      const result = parse('- [x] Checked task')
      expect(result).toBe('<ul>\n<li><input type="checkbox" checked disabled> Checked task</li>\n</ul>\n')
    })

    it('should parse checked task list item (uppercase X)', () => {
      const result = parse('- [X] Checked task')
      expect(result).toBe('<ul>\n<li><input type="checkbox" checked disabled> Checked task</li>\n</ul>\n')
    })

    it('should parse multiple task list items', () => {
      const result = parse('- [ ] Task 1\n- [x] Task 2\n- [ ] Task 3')
      expect(result).toContain('<input type="checkbox" disabled> Task 1')
      expect(result).toContain('<input type="checkbox" checked disabled> Task 2')
      expect(result).toContain('<input type="checkbox" disabled> Task 3')
    })

    it('should parse mixed task and regular list items', () => {
      const result = parse('- [ ] Task item\n- Regular item')
      expect(result).toContain('<input type="checkbox" disabled> Task item')
      expect(result).toContain('<li>Regular item</li>')
    })

    it('should work with ordered lists', () => {
      const result = parse('1. [ ] Task 1\n2. [x] Task 2')
      expect(result).toContain('<input type="checkbox" disabled> Task 1')
      expect(result).toContain('<input type="checkbox" checked disabled> Task 2')
    })

    it('should parse task list with emphasis', () => {
      const result = parse('- [x] **Bold** task')
      expect(result).toContain('<input type="checkbox" checked disabled>')
      expect(result).toContain('<strong>Bold</strong>')
    })
  })

  describe('Tables', () => {
    it('should parse basic table', () => {
      const markdown = '| Header 1 | Header 2 |\n| -------- | -------- |\n| Cell 1   | Cell 2   |'
      const result = parse(markdown)
      expect(result).toContain('<table>')
      expect(result).toContain('<thead>')
      expect(result).toContain('<tbody>')
      expect(result).toContain('<th>Header 1</th>')
      expect(result).toContain('<th>Header 2</th>')
      expect(result).toContain('<td>Cell 1</td>')
      expect(result).toContain('<td>Cell 2</td>')
    })

    it('should parse table with left alignment', () => {
      const markdown = '| Left |\n| :--- |\n| L1   |'
      const result = parse(markdown)
      expect(result).toContain('<th align="left">Left</th>')
      expect(result).toContain('<td align="left">L1</td>')
    })

    it('should parse table with center alignment', () => {
      const markdown = '| Center |\n| :----: |\n| C1     |'
      const result = parse(markdown)
      expect(result).toContain('<th align="center">Center</th>')
      expect(result).toContain('<td align="center">C1</td>')
    })

    it('should parse table with right alignment', () => {
      const markdown = '| Right |\n| ----: |\n| R1    |'
      const result = parse(markdown)
      expect(result).toContain('<th align="right">Right</th>')
      expect(result).toContain('<td align="right">R1</td>')
    })

    it('should parse table with mixed alignment', () => {
      const markdown = '| Left | Center | Right |\n| :--- | :----: | ----: |\n| L1   | C1     | R1    |'
      const result = parse(markdown)
      expect(result).toContain('<th align="left">Left</th>')
      expect(result).toContain('<th align="center">Center</th>')
      expect(result).toContain('<th align="right">Right</th>')
    })

    it('should parse table with multiple rows', () => {
      const markdown = '| A | B |\n| - | - |\n| 1 | 2 |\n| 3 | 4 |'
      const result = parse(markdown)
      expect(result).toContain('<td>1</td>')
      expect(result).toContain('<td>2</td>')
      expect(result).toContain('<td>3</td>')
      expect(result).toContain('<td>4</td>')
    })

    it('should parse table with inline emphasis', () => {
      const markdown = '| Header |\n| ------ |\n| **bold** |'
      const result = parse(markdown)
      expect(result).toContain('<strong>bold</strong>')
    })
  })

  describe('Extended Autolinks', () => {
    it('should auto-link https URLs', () => {
      const result = parse('Visit https://example.com for info')
      expect(result).toContain('<a href="https://example.com">https://example.com</a>')
    })

    it('should auto-link http URLs', () => {
      const result = parse('Check out http://example.com')
      expect(result).toContain('<a href="http://example.com">http://example.com</a>')
    })

    it('should auto-link www URLs with http:// prefix', () => {
      const result = parse('Visit www.example.com')
      expect(result).toContain('<a href="http://www.example.com">www.example.com</a>')
    })

    it('should auto-link URLs with paths', () => {
      const result = parse('See https://example.com/path/to/page')
      expect(result).toContain('<a href="https://example.com/path/to/page">https://example.com/path/to/page</a>')
    })

    it('should auto-link URLs with query strings', () => {
      const result = parse('https://example.com?foo=bar&baz=qux')
      expect(result).toContain('<a href="https://example.com?foo=bar&amp;baz=qux">https://example.com?foo=bar&amp;baz=qux</a>')
    })

    it('should auto-link multiple URLs in same paragraph', () => {
      const result = parse('Visit https://example.com and http://another.com')
      expect(result).toContain('<a href="https://example.com">https://example.com</a>')
      expect(result).toContain('<a href="http://another.com">http://another.com</a>')
    })

    it('should not auto-link inside code', () => {
      const result = parse('Use `https://example.com` as template')
      expect(result).not.toContain('<a href="https://example.com">')
      expect(result).toContain('<code>https://example.com</code>')
    })
  })
})
