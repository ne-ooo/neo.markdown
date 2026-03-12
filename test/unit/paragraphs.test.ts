import { describe, it, expect } from 'vitest'
import { parse } from '../../src/index.js'

describe('Paragraphs', () => {
  it('should parse simple paragraph', () => {
    const result = parse('Hello World')
    expect(result).toBe('<p>Hello World</p>\n')
  })

  it('should parse multiple paragraphs', () => {
    const result = parse('First paragraph\n\nSecond paragraph')
    expect(result).toBe('<p>First paragraph</p>\n<p>Second paragraph</p>\n')
  })

  it('should parse paragraph with inline emphasis', () => {
    const result = parse('This is **bold** and *italic*')
    expect(result).toBe('<p>This is <strong>bold</strong> and <em>italic</em></p>\n')
  })

  it('should parse paragraph with inline code', () => {
    const result = parse('Use the `code` function')
    expect(result).toBe('<p>Use the <code>code</code> function</p>\n')
  })

  it('should parse paragraph with link', () => {
    const result = parse('Visit [Google](https://google.com)')
    expect(result).toBe('<p>Visit <a href="https://google.com">Google</a></p>\n')
  })

  it('should parse paragraph with image', () => {
    const result = parse('![Alt text](https://example.com/image.png)')
    expect(result).toBe('<p><img src="https://example.com/image.png" alt="Alt text"></p>\n')
  })

  it('should parse multi-line paragraph as single paragraph', () => {
    const result = parse('Line 1\nLine 2\nLine 3')
    expect(result).toBe('<p>Line 1\nLine 2\nLine 3</p>\n')
  })

  it('should handle mixed content', () => {
    const result = parse('# Heading\n\nA paragraph\n\nAnother paragraph')
    expect(result).toBe('<h1>Heading</h1>\n<p>A paragraph</p>\n<p>Another paragraph</p>\n')
  })
})
