import { describe, it, expect } from 'vitest'
import { createParser } from '../../src/index.js'

describe('lazyImages option', () => {
  it('default: images have loading="lazy"', () => {
    const parser = createParser()
    const html = parser.parse('![alt](image.png)')
    expect(html).toContain('loading="lazy"')
  })

  it('lazyImages: false — no loading attribute', () => {
    const parser = createParser({ lazyImages: false })
    const html = parser.parse('![alt](image.png)')
    expect(html).not.toContain('loading=')
  })

  it('lazyImages: true — images have loading="lazy"', () => {
    const parser = createParser({ lazyImages: true })
    const html = parser.parse('![alt](image.png)')
    expect(html).toContain('loading="lazy"')
  })

  it('works with title attribute', () => {
    const parser = createParser()
    const html = parser.parse('![alt](image.png "Photo")')
    expect(html).toContain('loading="lazy"')
    expect(html).toContain('title="Photo"')
  })

  it('works with alt text', () => {
    const parser = createParser()
    const html = parser.parse('![My alt text](image.png)')
    expect(html).toContain('alt="My alt text"')
    expect(html).toContain('loading="lazy"')
  })
})
