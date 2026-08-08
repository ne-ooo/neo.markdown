import { describe, it, expect } from 'vitest'
import { createParser, parse } from '../../src/index.js'
import {
  copyCodePlugin,
  getCopyCodeStyles,
  initializeCopyCode,
} from '../../src/plugins/copy-code.js'

describe('copyCodePlugin', () => {
  it('wraps code blocks with an inert copy button', () => {
    const result = parse('```\ncode()\n```', { plugins: [copyCodePlugin()] })
    expect(result).toContain('<div class="code-block" data-copy-code-wrapper>')
    expect(result).toContain('<button class="copy-code-button" type="button" data-copy-code')
    expect(result).toContain('>Copy</button>')
    expect(result).toContain('</pre></div>')
    expect(result).not.toContain('<script')
  })

  it('retains pre attributes', () => {
    const result = parse('```js\nconst x = 1\n```', { plugins: [copyCodePlugin()] })
    expect(result).toContain('language-js')
  })

  it('escapes all user-configured labels', () => {
    const plugin = copyCodePlugin({
      buttonText: '<img src=x onerror=alert(1)>',
      copiedText: '\" onmouseover=\"alert(1)',
    })
    const result = parse('```\ntest\n```', { plugins: [plugin] })

    expect(result).not.toContain('<img')
    expect(result).not.toContain('" onmouseover=')
    expect(result).toContain('&lt;img')
    expect(result).toContain('&quot; onmouseover=&quot;')
  })

  it('uses custom valid classes and rejects selector injection', () => {
    const result = parse('```\ntest\n```', {
      plugins: [copyCodePlugin({ buttonClass: 'btn-copy', wrapperClass: 'highlight' })],
    })
    expect(result).toContain('class="btn-copy"')
    expect(result).toContain('class="highlight"')
    expect(() => copyCodePlugin({ buttonClass: 'x, body' })).toThrow(TypeError)
    expect(() => copyCodePlugin({ wrapperClass: 'x{color:red}' })).toThrow(TypeError)
  })

  it('wraps every code block', () => {
    const md = '```\nfirst\n```\n\nParagraph\n\n```\nsecond\n```'
    const result = parse(md, { plugins: [copyCodePlugin()] })
    expect(result.match(/data-copy-code-wrapper/g)).toHaveLength(2)
    expect(result.match(/<button /g)).toHaveLength(2)
  })

  it('does not affect non-code content', () => {
    const result = parse('# Heading\n\nParagraph', { plugins: [copyCodePlugin()] })
    expect(result).not.toContain('data-copy-code')
    expect(result).not.toContain('<style>')
    expect(result).toContain('<h1>Heading</h1>')
  })

  it('emits styles for every document when a parser is reused', () => {
    const parser = createParser({ plugins: [copyCodePlugin()] })
    expect(parser.parse('```\none\n```')).toContain('<style>')
    expect(parser.parse('```\ntwo\n```')).toContain('<style>')
  })

  it('can omit inline styles and export the same CSS separately', () => {
    const result = parse('```\ncode\n```', {
      plugins: [copyCodePlugin({ injectStyles: false })],
    })
    expect(result).not.toContain('<style>')
    expect(getCopyCodeStyles()).toContain('.copy-code-button')
  })

  it('exports an SSR-safe explicit initializer', () => {
    const cleanup = initializeCopyCode()
    expect(cleanup).toBeTypeOf('function')
    expect(() => cleanup()).not.toThrow()
  })
})
