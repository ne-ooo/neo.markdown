import { describe, it, expect } from 'vitest'
import { createParser } from '../../src/index.js'
import type { HeadingToken, CodeToken, LinkToken, ImageToken } from '../../src/index.js'

describe('renderer option', () => {
  it('custom heading renderer is called with correct token', () => {
    const parser = createParser({
      renderer: {
        heading(token: HeadingToken) {
          return `<h${token.level} class="custom">${this.renderInline(token.tokens)}</h${token.level}>\n`
        },
      },
    })

    const html = parser.parse('# Hello')
    expect(html).toBe('<h1 class="custom">Hello</h1>\n')
  })

  it('custom code renderer is called', () => {
    const parser = createParser({
      renderer: {
        code(token: CodeToken) {
          return `<pre class="highlight"><code>${token.text}</code></pre>\n`
        },
      },
    })

    const html = parser.parse('```\nconsole.log("hi")\n```')
    expect(html).toBe('<pre class="highlight"><code>console.log("hi")</code></pre>\n')
  })

  it('custom link renderer is called', () => {
    const parser = createParser({
      renderer: {
        link(token: LinkToken) {
          return `<a href="${token.href}" rel="nofollow">${this.renderInline(token.tokens)}</a>`
        },
      },
    })

    const html = parser.parse('[click](https://example.com)')
    expect(html).toContain('rel="nofollow"')
    expect(html).toContain('href="https://example.com"')
  })

  it('partial overrides do not break other renderer methods', () => {
    const parser = createParser({
      renderer: {
        heading(token: HeadingToken) {
          return `<div class="heading">${this.renderInline(token.tokens)}</div>\n`
        },
      },
    })

    // Heading is customized
    expect(parser.parse('# Title')).toBe('<div class="heading">Title</div>\n')
    // Paragraph still works normally
    expect(parser.parse('Normal text')).toBe('<p>Normal text</p>\n')
    // Code still works normally
    expect(parser.parse('```\ncode\n```')).toContain('<pre><code>')
  })

  it('multiple overrides work together', () => {
    const parser = createParser({
      renderer: {
        heading(token: HeadingToken) {
          return `<h${token.level} class="custom">${this.renderInline(token.tokens)}</h${token.level}>\n`
        },
        image(token: ImageToken) {
          return `<img src="${token.href}" alt="${token.text}" loading="lazy">`
        },
      },
    })

    expect(parser.parse('# Title')).toContain('class="custom"')
    expect(parser.parse('![alt](img.png)')).toContain('loading="lazy"')
  })

  it('overridden renderer has access to this (renderer instance)', () => {
    const parser = createParser({
      renderer: {
        heading(token: HeadingToken) {
          // `this` should be the renderer instance, so renderInline should work
          const text = this.renderInline(token.tokens)
          return `<h${token.level}>${text}</h${token.level}>\n`
        },
      },
    })

    // Inline formatting inside heading should still work
    expect(parser.parse('# Hello **world**')).toBe('<h1>Hello <strong>world</strong></h1>\n')
  })

  it('plugin renderer overrides take precedence over options.renderer', () => {
    const customPlugin = (builder: import('../../src/index.js').PluginBuilder) => {
      builder.setRenderer('heading', (token: HeadingToken) => {
        return `<h${token.level} data-plugin="true">${builder.renderInline(token.tokens)}</h${token.level}>\n`
      })
    }

    const parser = createParser({
      renderer: {
        heading(token: HeadingToken) {
          return `<h${token.level} data-user="true">${this.renderInline(token.tokens)}</h${token.level}>\n`
        },
      },
      plugins: [customPlugin],
    })

    const html = parser.parse('# Hello')
    // Plugin should win
    expect(html).toContain('data-plugin="true"')
    expect(html).not.toContain('data-user="true"')
  })
})
