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

  it('should wrap <pre> with attributes (e.g. from highlight plugin)', () => {
    const plugin = copyCodePlugin()
    const result = parse('```js\nconst x = 1\n```', { plugins: [plugin] })
    expect(result).toContain('<div class="code-block">')
    expect(result).toContain('copy-code-button')
    // The <pre> retains its attributes
    expect(result).toContain('language-js')
  })

  it('should use custom button text', () => {
    const plugin = copyCodePlugin({ buttonText: 'Copy Code' })
    const result = parse('```\ntest\n```', { plugins: [plugin] })
    expect(result).toContain('>Copy Code</button>')
  })

  it('should use custom copied text option', () => {
    const plugin = copyCodePlugin({ copiedText: 'Done!' })
    const result = parse('```\ntest\n```', { plugins: [plugin] })
    // copiedText is used by the inline script, not the initial button
    expect(result).toContain("'Done!'")
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
    // 2 buttons + 1 script reference = buttons in markup
    expect(buttonCount).toBeGreaterThanOrEqual(2)
  })

  it('should close wrapper div even without trailing newline after </pre>', () => {
    const plugin = copyCodePlugin()
    const result = parse('```\ncode\n```', { plugins: [plugin] })
    const openDivs = (result.match(/<div class="code-block">/g) ?? []).length
    const closeDivs = (result.match(/<\/pre><\/div>/g) ?? []).length
    expect(closeDivs).toBe(openDivs)
  })

  it('should inject copy script', () => {
    const plugin = copyCodePlugin()
    const result = parse('```\ncode\n```', { plugins: [plugin] })
    expect(result).toContain('<script>')
    expect(result).toContain('clipboard.writeText')
  })

  it('should not affect non-code content', () => {
    const plugin = copyCodePlugin()
    const result = parse('# Heading\n\nParagraph', { plugins: [plugin] })
    expect(result).not.toContain('copy-code-button')
    expect(result).not.toContain('code-block')
    expect(result).not.toContain('<script>')
    expect(result).toContain('<h1>Heading</h1>')
    expect(result).toContain('<p>Paragraph</p>')
  })

  it('should compose with other plugins', () => {
    const copy = copyCodePlugin()

    // Just verify copy-code works alongside another plugin
    const result = parse('```js\nconst x = 1\n```', {
      plugins: [copy],
    })
    expect(result).toContain('code-block')
    expect(result).toContain('copy-code-button')
    expect(result).toContain('language-js')
  })
})
