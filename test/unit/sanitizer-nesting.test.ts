import { describe, expect, it } from 'vitest'
import { MAX_HTML_NESTING_DEPTH } from '../../src/sanitizers/structural.js'
import { createParser } from '../../src/sanitized.js'

const parser = () => createParser({ allowHtml: true, sanitize: true })
const refusal = new RangeError(`HTML nesting exceeds ${MAX_HTML_NESTING_DEPTH} elements`)
const nested = (depth: number, inner = 'x') => `${'<div>'.repeat(depth)}${inner}${'</div>'.repeat(depth)}`

describe('HTML nesting in the structural sanitizer', () => {
  it('accepts HTML as deep as the limit, and refuses one level deeper', () => {
    expect(() => parser().parse(nested(MAX_HTML_NESTING_DEPTH))).not.toThrow()
    expect(() => parser().parse(nested(MAX_HTML_NESTING_DEPTH + 1))).toThrow(refusal)
  })

  // The depth is the parser's own: end tags it reads as text close nothing.
  it.each([
    ['SVG character data', `<svg><![CDATA[${'</div>'.repeat(300)}]]></svg>`],
    ['a script', `<script>${'</div>'.repeat(300)}</script>`],
    ['a comment', `<!--${'</div>'.repeat(300)}-->`],
  ])('counts end tags inside %s as text', (_, hidden) => {
    const html = `${'<div>'.repeat(200)}${hidden}${'<div>'.repeat(100)}`

    expect(() => parser().parse(html)).toThrow(refusal)
  })

  it('counts elements the parser closes for itself as closed', () => {
    expect(() => parser().parse(`<div>${'<p>a'.repeat(1_000)}</div>`)).not.toThrow()
    expect(() => parser().parse(`<ul>${'<li>a'.repeat(1_000)}</ul>`)).not.toThrow()
    expect(() => parser().parse(`<div>${'<br><img src="x">'.repeat(1_000)}</div>`)).not.toThrow()
  })

  // The parser moved every open element on each new one: 1 MB of nested
  // tags took 2 to 14 seconds to sanitize.
  it.each([
    ['open', '<div>'.repeat(200_000)],
    ['open inline', '<span>'.repeat(170_000)],
    ['closed', nested(100_000)],
  ])('refuses 1 MB of %s nested tags as soon as they pass the limit', (_, html) => {
    expect(() => parser().parse(html)).toThrow(refusal)
  })

  it('starts each document from no open elements', () => {
    const sanitized = parser()

    expect(() => sanitized.parse(nested(MAX_HTML_NESTING_DEPTH + 1))).toThrow(refusal)
    expect(sanitized.parse(nested(MAX_HTML_NESTING_DEPTH))).toContain('x')
  })

  it('sanitizes nested HTML within the limit as before', () => {
    expect(parser().parse('<details><summary>s</summary><div><div><b>x</b></div></div></details>')).toBe(
      '<details><summary>s</summary><div><div><b>x</b></div></div></details>\n',
    )
  })
})
