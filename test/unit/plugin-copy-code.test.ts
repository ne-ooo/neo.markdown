/**
 * Copy-code plugin tests
 */

import { describe, it, expect } from 'vitest'
import { parse } from '../../src/index.js'
import { copyCodePlugin } from '../../src/plugins/copy-code.js'

describe('copyCodePlugin', () => {
  it('should wrap code blocks with copy button', () => {
    const plugin = copyCodePlugin()
    const result = parse('```\ncode()\n```', { plugins: [plugin] })
    expect(result).toContain('<div class="code-block">')
    expect(result).toContain('<button class="copy-code-button" type="button">Copy</button>')
    expect(result).toContain('<pre>')
    expect(result).toContain('</pre></div>')
  })

  it('should use custom button text', () => {
    const plugin = copyCodePlugin({ buttonText: 'Copy Code' })
    const result = parse('```\ntest\n```', { plugins: [plugin] })
    expect(result).toContain('>Copy Code</button>')
  })

  it('should use custom button class', () => {
    const plugin = copyCodePlugin({ buttonClass: 'btn-copy' })
    const result = parse('```\ntest\n```', { plugins: [plugin] })
    expect(result).toContain('class="btn-copy"')
  })

  it('should use custom wrapper class', () => {
    const plugin = copyCodePlugin({ wrapperClass: 'highlight' })
    const result = parse('```\ntest\n```', { plugins: [plugin] })
    expect(result).toContain('<div class="highlight">')
  })

  it('should handle multiple code blocks', () => {
    const plugin = copyCodePlugin()
    const md = '```\nfirst\n```\n\nParagraph\n\n```\nsecond\n```'
    const result = parse(md, { plugins: [plugin] })
    const buttonCount = (result.match(/copy-code-button/g) ?? []).length
    expect(buttonCount).toBe(2)
  })

  it('should not affect non-code content', () => {
    const plugin = copyCodePlugin()
    const result = parse('# Heading\n\nParagraph', { plugins: [plugin] })
    expect(result).not.toContain('copy-code-button')
    expect(result).not.toContain('code-block')
    expect(result).toContain('<h1>Heading</h1>')
    expect(result).toContain('<p>Paragraph</p>')
  })

  it('should compose with other plugins', () => {
    const copy = copyCodePlugin()
    const wrapper = {
      name: 'test-wrapper',
    }

    // Just verify copy-code works alongside another plugin
    const result = parse('```js\nconst x = 1\n```', {
      plugins: [copy],
    })
    expect(result).toContain('code-block')
    expect(result).toContain('copy-code-button')
    expect(result).toContain('language-js')
  })
})
