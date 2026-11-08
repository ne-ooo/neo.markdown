import { describe, expect, it } from 'vitest'
import { createParser } from '../../src/index.js'
import { createParser as createSanitizedParser } from '../../src/sanitized.js'

// A long destination used by many references: each use repeats it, so this
// renders to about 500 times its length.
const expanding = (uses: number) => `[r]: https://example.com/${'a'.repeat(2000)}\n\n${'[r] '.repeat(uses)}`

describe('maxOutputLength', () => {
  it('stops an expanding document before its HTML is built', () => {
    const parser = createParser({ gfm: true, maxOutputLength: 1_000_000 })
    const started = performance.now()

    expect(() => parser.parse(expanding(120_000))).toThrow(
      new RangeError('Rendered HTML exceeds maxOutputLength 1000000'),
    )
    expect(performance.now() - started).toBeLessThan(1_000)
  })

  it('counts the document once, however deeply its blocks nest', () => {
    const documents = [
      '# T\n\n> quote *x*\n\n- a\n- [b](https://x.y)\n\n```js\nconst a = 1\n```\n\n| a | b |\n|---|---|\n| 1 | **2** |\n',
      Array.from({ length: 200 }, () => `> > - **[l](https://e.com/${'c'.repeat(50)})** \`x\` ~~y~~`).join('\n'),
      '1. a\n   - b\n     > c *d* [e][r]\n\n[r]: https://r.r\n',
    ]
    for (const markdown of documents) {
      const length = createParser({ gfm: true }).parse(markdown).length
      expect(createParser({ gfm: true, maxOutputLength: length }).parse(markdown)).toHaveLength(length)
      expect(() => createParser({ gfm: true, maxOutputLength: length - 1 }).parse(markdown)).toThrow(RangeError)
    }
  })

  it('renders the same HTML as an unlimited parser when the document fits', () => {
    const markdown = '# T\n\n> *q*\n\n- [a](https://x.y)\n\n```js\nconst a = 1\n```\n'.repeat(300)
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
