import { describe, expect, it } from 'vitest'
import { createParser } from '../../src/index.js'
import { createParser as createSanitizedParser } from '../../src/sanitized.js'

// A long destination used by many references: each use repeats it, so this
// renders to about 500 times its length.
const expanding = (uses: number) => `[r]: https://example.com/${'a'.repeat(2000)}\n\n${'[r] '.repeat(uses)}`

describe('maxOutputLength', () => {
  it('stops an expanding document before its HTML is built', () => {
    let links = 0
    const parser = createParser({
      gfm: true,
      maxOutputLength: 1_000_000,
      renderer: {
        link: (token) => {
          links++
          return `<a href="${token.href}">r</a>`
        },
      },
    })

    expect(() => parser.parse(expanding(120_000))).toThrow(
      new RangeError('Rendered HTML exceeds maxOutputLength 1000000'),
    )
    // About 490 links pass the limit, of the 120,000 the document holds.
    expect(links).toBeLessThan(1_000)
  })

  it('counts the document once, however deeply its blocks nest', () => {
    const documents = [
      '# T\n\n> quote *x*\n\n- a\n- [b](https://x.y)\n\n```js\nconst a = 1\n```\n\n| a | b |\n|---|---|\n| 1 | **2** |\n',
      Array.from({ length: 200 }, () => `> > - **[l](https://e.com/${'c'.repeat(50)})** \`x\` ~~y~~`).join('\n'),
      '1. a\n   - b\n     > c *d* [e][r]\n\n[r]: https://r.r\n',
      '- a\n\n  ```js\n  x\n  ```\n\n  | a | b |\n  |:-:|---|\n  | 1 |\n- [ ] task\n  - nested\n\n  more\n',
      '| a | b | c |\n|---|:-:|--:|\n| 1 |\n| *2* | 3 |\n\n| only |\n|---|\n',
    ]
    for (const markdown of documents) {
      const length = createParser({ gfm: true }).parse(markdown).length
      expect(createParser({ gfm: true, maxOutputLength: length }).parse(markdown)).toHaveLength(length)
      expect(() => createParser({ gfm: true, maxOutputLength: length - 1 }).parse(markdown)).toThrow(RangeError)
    }
  })

  it('stops a list at the item that passes the limit', () => {
    for (const markdown of [
      Array.from({ length: 1_000 }, () => '- ```\n  x\n  ```').join('\n'),
      Array.from({ length: 1_000 }, () => '- a\n\n  ```\n  x\n  ```\n').join('\n'),
    ]) {
      let renders = 0
      const parser = createParser({
        maxOutputLength: 1_000,
        renderer: {
          code: () => {
            renders++
            return 'y'.repeat(50_000)
          },
        },
      })

      expect(() => parser.parse(markdown)).toThrow(RangeError)
      expect(renders).toBe(1)
    }
  })

  it('stops a table at the cell that passes the limit, counting cells added to short rows', () => {
    // Each one-character row is padded to the header's 200 columns.
    const markdown = `${'|a'.repeat(200)}|\n${'|:-:'.repeat(200)}|\n${'a\n'.repeat(1_000)}`
    let cells = 0
    const parser = createParser({
      gfm: true,
      maxOutputLength: 1_000,
      renderer: {
        tablecell: (text) => {
          cells++
          return `<td>${text}</td>\n`
        },
      },
    })

    expect(() => parser.parse(markdown)).toThrow(RangeError)
    expect(cells).toBeLessThan(200)
  })

  it('counts HTML that a custom renderer renders and then discards', () => {
    const parser = createParser({
      maxOutputLength: 10,
      renderer: {
        paragraph(token) {
          this.renderInline(token.tokens)
          return 'ok'
        },
      },
    })

    expect(parser.parse('short')).toBe('ok')
    expect(() => parser.parse('x'.repeat(11))).toThrow(RangeError)
  })

  it('renders the same HTML as an unlimited parser when the document fits', () => {
    const markdown = '# T\n\n> *q*\n\n- [a](https://x.y)\n\n  ```js\n  b\n  ```\n\n```js\nconst a = 1\n```\n\n| a | b |\n|---|---|\n| 1 |\n'.repeat(300)
    expect(createParser({ gfm: true, maxOutputLength: 10_000_000 }).parse(markdown)).toBe(
      createParser({ gfm: true }).parse(markdown),
    )
  })

  it('applies before sanitizing, and leaves the parser usable after it stops', () => {
    const parser = createSanitizedParser({ allowHtml: true, sanitize: true, maxOutputLength: 100_000 })

    expect(() => parser.parse(expanding(10_000))).toThrow(RangeError)
    expect(parser.parse('*ok*')).toBe('<p><em>ok</em></p>\n')
  })

  it('caps UGC output, even above a larger requested limit', () => {
    const expandingUnderTokenLimit = `[r]: https://example.com/${'a'.repeat(50_000)}\n\n${'[r] '.repeat(1_000)}`

    for (const maxOutputLength of [undefined, Number.MAX_SAFE_INTEGER]) {
      expect(() => createParser({ ugc: true, maxOutputLength }).parse(expandingUnderTokenLimit)).toThrow(
        new RangeError('Rendered HTML exceeds maxOutputLength 20000000'),
      )
    }
  })

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('rejects %s as a limit', (maxOutputLength) => {
    expect(() => createParser({ maxOutputLength })).toThrow(
      new TypeError('maxOutputLength must be a non-negative safe integer'),
    )
  })
})
