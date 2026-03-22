import { describe, it, expect } from 'vitest'
import { createParser } from '../../src/index.js'

describe('breaks option', () => {
  it('breaks: true — bare newline produces <br>', () => {
    const parser = createParser({ breaks: true })
    const html = parser.parse('Line 1\nLine 2')
    expect(html).toBe('<p>Line 1<br>\nLine 2</p>\n')
  })

  it('breaks: false (default) — bare newline does not produce <br>', () => {
    const parser = createParser({ breaks: false })
    const html = parser.parse('Line 1\nLine 2')
    expect(html).not.toContain('<br>')
  })

  it('default (no breaks option) — bare newline does not produce <br>', () => {
    const parser = createParser()
    const html = parser.parse('Line 1\nLine 2')
    expect(html).not.toContain('<br>')
  })

  it('breaks: true — two-space line break still works', () => {
    const parser = createParser({ breaks: true })
    const html = parser.parse('Line 1  \nLine 2')
    expect(html).toContain('<br>')
    expect(html).toContain('Line 1')
    expect(html).toContain('Line 2')
  })

  it('breaks: true — double newline still creates separate paragraphs', () => {
    const parser = createParser({ breaks: true })
    const html = parser.parse('Line 1\n\nLine 2')
    expect(html).toContain('<p>Line 1</p>')
    expect(html).toContain('<p>Line 2</p>')
  })

  it('breaks: true — works inside blockquotes', () => {
    const parser = createParser({ breaks: true })
    const html = parser.parse('> Line 1\n> Line 2')
    expect(html).toContain('<br>')
  })

  it('breaks: true — works inside list items', () => {
    const parser = createParser({ breaks: true })
    const html = parser.parse('- Item 1\n  Line 2')
    expect(html).toContain('Item 1')
  })
})
