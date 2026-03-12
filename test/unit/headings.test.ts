import { describe, it, expect } from 'vitest'
import { parse } from '../../src/index.js'

describe('Headings', () => {
  it('should parse h1 heading', () => {
    const result = parse('# Hello World')
    expect(result).toBe('<h1>Hello World</h1>\n')
  })

  it('should parse h2 heading', () => {
    const result = parse('## Hello World')
    expect(result).toBe('<h2>Hello World</h2>\n')
  })

  it('should parse h3 heading', () => {
    const result = parse('### Hello World')
    expect(result).toBe('<h3>Hello World</h3>\n')
  })

  it('should parse h4 heading', () => {
    const result = parse('#### Hello World')
    expect(result).toBe('<h4>Hello World</h4>\n')
  })

  it('should parse h5 heading', () => {
    const result = parse('##### Hello World')
    expect(result).toBe('<h5>Hello World</h5>\n')
  })

  it('should parse h6 heading', () => {
    const result = parse('###### Hello World')
    expect(result).toBe('<h6>Hello World</h6>\n')
  })

  it('should parse heading with inline emphasis', () => {
    const result = parse('# Hello **World**')
    expect(result).toBe('<h1>Hello <strong>World</strong></h1>\n')
  })

  it('should parse heading with inline code', () => {
    const result = parse('# Hello `code`')
    expect(result).toBe('<h1>Hello <code>code</code></h1>\n')
  })

  it('should parse heading with link', () => {
    const result = parse('# [Link](https://example.com)')
    expect(result).toBe('<h1><a href="https://example.com">Link</a></h1>\n')
  })

  it('should trim whitespace from heading text', () => {
    const result = parse('#  Heading with spaces  ')
    expect(result).toBe('<h1>Heading with spaces</h1>\n')
  })

  it('should parse multiple headings', () => {
    const result = parse('# H1\n\n## H2\n\n### H3')
    expect(result).toBe('<h1>H1</h1>\n<h2>H2</h2>\n<h3>H3</h3>\n')
  })

  it('should require space after # for heading', () => {
    const result = parse('#NoSpace')
    expect(result).toBe('<p>#NoSpace</p>\n')
  })
})
