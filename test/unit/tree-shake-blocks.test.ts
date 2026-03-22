import { describe, it, expect } from 'vitest'
import { createParser } from '../../src/index.js'
import {
  heading,
  paragraph,
  code,
  list,
  blockquote,
  hr,
  table,
  html,
  indentedCode,
  setextHeading,
  allBlockRules,
} from '../../src/blocks/index.js'

describe('tree-shakeable blocks', () => {
  describe('selective block loading', () => {
    it('parser with only heading + paragraph skips other block types', () => {
      const parser = createParser({ blocks: [heading, paragraph] })

      // Headings work
      expect(parser.parse('# Title')).toContain('<h1>')

      // Paragraphs work
      expect(parser.parse('Hello world')).toContain('<p>')

      // Code blocks are NOT parsed (no code rule)
      const codeResult = parser.parse('```\ncode\n```')
      expect(codeResult).not.toContain('<pre><code>')

      // HR is NOT parsed
      const hrResult = parser.parse('---')
      expect(hrResult).not.toContain('<hr>')
    })

    it('parser with heading + paragraph + code works', () => {
      const parser = createParser({ blocks: [heading, paragraph, code] })

      expect(parser.parse('# Title')).toContain('<h1>')
      expect(parser.parse('```js\nconst x = 1\n```')).toContain('<pre><code')
      expect(parser.parse('Hello')).toContain('<p>')
    })

    it('parser with list works correctly', () => {
      const parser = createParser({ blocks: [list, paragraph] })
      const result = parser.parse('- item 1\n- item 2')
      expect(result).toContain('<ul>')
      expect(result).toContain('<li>')
    })

    it('parser with blockquote works correctly', () => {
      const parser = createParser({ blocks: [blockquote, paragraph] })
      const result = parser.parse('> quoted text')
      expect(result).toContain('<blockquote>')
    })

    it('parser with table + paragraph', () => {
      const parser = createParser({ blocks: [table, paragraph], gfm: true })
      const result = parser.parse('| A | B |\n|---|---|\n| 1 | 2 |')
      expect(result).toContain('<table>')
    })

    it('table rule respects gfm: false', () => {
      const parser = createParser({ blocks: [table, paragraph], gfm: false })
      const result = parser.parse('| A | B |\n|---|---|\n| 1 | 2 |')
      expect(result).not.toContain('<table>')
    })

    it('parser with hr works', () => {
      const parser = createParser({ blocks: [hr, paragraph] })
      expect(parser.parse('---')).toContain('<hr>')
    })

    it('html rule respects allowHtml option', () => {
      const parser = createParser({ blocks: [html, paragraph], allowHtml: true })
      const result = parser.parse('<div>raw html</div>')
      expect(result).toContain('<div>raw html</div>')
    })

    it('indentedCode rule works', () => {
      const parser = createParser({ blocks: [indentedCode, paragraph] })
      const result = parser.parse('    indented code')
      expect(result).toContain('<pre><code>')
      expect(result).toContain('indented code')
    })

    it('setextHeading rule works', () => {
      const parser = createParser({ blocks: [setextHeading, paragraph] })
      expect(parser.parse('Title\n=====')).toContain('<h1>')
      expect(parser.parse('Subtitle\n-----')).toContain('<h2>')
    })
  })

  describe('allBlockRules convenience export', () => {
    it('contains all built-in rules', () => {
      expect(allBlockRules).toHaveLength(10)
      const names = allBlockRules.map((r) => r.name)
      expect(names).toContain('code')
      expect(names).toContain('heading')
      expect(names).toContain('setextHeading')
      expect(names).toContain('paragraph')
      expect(names).toContain('list')
      expect(names).toContain('blockquote')
      expect(names).toContain('table')
      expect(names).toContain('hr')
      expect(names).toContain('html')
      expect(names).toContain('indentedCode')
    })

    it('parser with allBlockRules works like default parser', () => {
      const defaultParser = createParser()
      const customParser = createParser({ blocks: allBlockRules })

      const md = '# Title\n\nParagraph\n\n```js\ncode\n```\n\n- item\n\n> quote\n\n---'

      const defaultHtml = defaultParser.parse(md)
      const customHtml = customParser.parse(md)

      expect(customHtml).toBe(defaultHtml)
    })
  })

  describe('plugins work with custom blocks', () => {
    it('plugin rules work alongside custom blocks', () => {
      const parser = createParser({
        blocks: [heading, paragraph, code],
        plugins: [
          (builder) => {
            builder.setRenderer('heading', (token) => {
              return `<h${token.level} class="custom">${builder.renderInline(token.tokens)}</h${token.level}>\n`
            })
          },
        ],
      })

      expect(parser.parse('# Title')).toContain('class="custom"')
    })
  })
})
