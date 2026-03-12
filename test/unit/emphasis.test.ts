import { describe, it, expect } from 'vitest'
import { parse } from '../../src/index.js'

describe('Emphasis (Bold and Italic)', () => {
  describe('Strong (Bold)', () => {
    it('should parse ** bold syntax', () => {
      const result = parse('**bold text**')
      expect(result).toBe('<p><strong>bold text</strong></p>\n')
    })

    it('should parse __ bold syntax', () => {
      const result = parse('__bold text__')
      expect(result).toBe('<p><strong>bold text</strong></p>\n')
    })

    it('should parse bold in middle of text', () => {
      const result = parse('This is **bold** text')
      expect(result).toBe('<p>This is <strong>bold</strong> text</p>\n')
    })

    it('should parse multiple bold sections', () => {
      const result = parse('**First** and **Second**')
      expect(result).toBe('<p><strong>First</strong> and <strong>Second</strong></p>\n')
    })

    it('should parse nested italic in bold', () => {
      // Phase 3: Fixed! Triple *** delimiter handling
      const result = parse('**bold *and italic***')
      expect(result).toBe('<p><strong>bold <em>and italic</em></strong></p>\n')
    })
  })

  describe('Emphasis (Italic)', () => {
    it('should parse * italic syntax', () => {
      const result = parse('*italic text*')
      expect(result).toBe('<p><em>italic text</em></p>\n')
    })

    it('should parse _ italic syntax', () => {
      const result = parse('_italic text_')
      expect(result).toBe('<p><em>italic text</em></p>\n')
    })

    it('should parse italic in middle of text', () => {
      const result = parse('This is *italic* text')
      expect(result).toBe('<p>This is <em>italic</em> text</p>\n')
    })

    it('should parse multiple italic sections', () => {
      const result = parse('*First* and *Second*')
      expect(result).toBe('<p><em>First</em> and <em>Second</em></p>\n')
    })

    it('should parse nested bold in italic', () => {
      const result = parse('*italic **and bold***')
      // Phase 2: Fixed! Now correctly parses nested emphasis
      expect(result).toBe('<p><em>italic <strong>and bold</strong></em></p>\n')
    })
  })

  describe('Combined Emphasis', () => {
    it('should parse bold and italic together', () => {
      const result = parse('**bold** and *italic*')
      expect(result).toBe('<p><strong>bold</strong> and <em>italic</em></p>\n')
    })

    it('should parse bold italic using ***', () => {
      // Phase 3: Fixed! Triple *** delimiter handling
      const result = parse('***bold and italic***')
      // Most markdown parsers do strong-em (not em-strong) for ***
      expect(result).toBe('<p><strong><em>bold and italic</em></strong></p>\n')
    })

    it('should handle complex nesting', () => {
      const result = parse('This is **bold with *italic* inside**')
      expect(result).toBe('<p>This is <strong>bold with <em>italic</em> inside</strong></p>\n')
    })
  })
})
