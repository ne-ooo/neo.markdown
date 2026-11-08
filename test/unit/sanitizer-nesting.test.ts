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

  // sanitize-html sanitizes a discarded iframe's text again as HTML, with a
  // parser of its own, whose elements count too.
  it('counts elements in the text of a discarded iframe', () => {
    expect(() => parser().parse(`<iframe>${'<div>'.repeat(170_000)}`)).toThrow(refusal)
    expect(parser().parse('<iframe><b>fallback</b></iframe>')).toContain('fallback')
  })

  // A tag cut off at the end of the iframe's text is closed without having
  // been opened, so a plain count of opens and closes fell by one for each.
  it.each([
    ['cut-off tags', '<iframe><a </iframe>'],
    ['cut-off tags of an open element\'s name', '<div><iframe><div </iframe>'],
    ['cut-off iframes', '<div><iframe><iframe </iframe>'],
  ])('keeps counting past discarded iframes ending in %s', (_, iframe) => {
    const opened = iframe.startsWith('<div>') ? 1 : 0

    expect(() => parser().parse(`${iframe.repeat(10)}${'<div>'.repeat(MAX_HTML_NESTING_DEPTH + 1 - 10 * opened)}`))
      .toThrow(refusal)
    expect(() => parser().parse(`${iframe.repeat(10)}${'<div>'.repeat(MAX_HTML_NESTING_DEPTH - 10 * opened)}`))
      .not.toThrow()
    expect(() => parser().parse(`<p>${iframe}${'</div>'.repeat(opened)}</p>`.repeat(1_000))).not.toThrow()
  })

  // In SVG an iframe's text isn't raw, and each CDATA section in it is parsed
  // again on its own. Each of those parses ending in a cut-off tag took an
  // element off the outer count.
  it('keeps counting past a discarded iframe in SVG whose CDATA sections end in cut-off tags', () => {
    const text = `<![CDATA[<iframe ]]>${'<![CDATA[<b ]]>'.repeat(250)}`

    expect(() => parser().parse(`<div><svg>${`${'<b>'.repeat(250)}<iframe>${text}`.repeat(3)}x</div>`)).toThrow(refusal)
    expect(() => parser().parse(`<div><svg><iframe>${text}</iframe></svg></div>`.repeat(300))).not.toThrow()
  })

  it('refuses 1 MB of nested tags after discarded iframes as soon as they pass the limit', () => {
    const started = performance.now()

    expect(() => parser().parse(`${'<iframe><a </iframe>'.repeat(45_557)}${'<b>'.repeat(45_813)}`)).toThrow(refusal)
    expect(performance.now() - started).toBeLessThan(5_000)
  })

  it('counts elements the parser closes for itself as closed', () => {
    expect(() => parser().parse(`<div>${'<p>a'.repeat(1_000)}</div>`)).not.toThrow()
    expect(() => parser().parse(`<ul>${'<li>a'.repeat(1_000)}</ul>`)).not.toThrow()
    expect(() => parser().parse(`<div>${'<br><img src="x">'.repeat(1_000)}</div>`)).not.toThrow()
  })

  // The parser moved every open element on each new one: 1 MB of nested
  // tags took from 6 seconds to a minute to sanitize.
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

describe('inputs in the structural sanitizer', () => {
  const gfm = () => createParser({ allowHtml: true, sanitize: true, gfm: true })

  it('keeps only disabled checkboxes', () => {
    expect(gfm().parse(
      '<p>a<input type="text">b<input type="checkbox" disabled>c<INPUT TYPE=CHECKBOX DISABLED>d<input type=checkbox>e</p>',
    )).toBe('<p>ab<input type="checkbox" disabled />c<input type="CHECKBOX" disabled />de</p>\n')
    expect(gfm().parse('- [ ] task\n- [x] done')).toBe(
      '<ul>\n<li><input type="checkbox" disabled /> task</li>\n<li><input type="checkbox" checked disabled /> done</li>\n</ul>\n',
    )
    expect(gfm().parse('<div><input value="x"><b>y</b></div>')).toBe('<div><b>y</b></div>\n')
  })

  // sanitize-html removes an element by cutting its output back to where the
  // element began, which copies all the output before it.
  it('refuses inputs whose removal would copy the output too many times', () => {
    const started = performance.now()

    expect(() => gfm().parse(`${'x'.repeat(512 * 1024)}${'<input>'.repeat(75_000)}`)).toThrow(
      new RangeError('HTML has too many inputs to remove'),
    )
    expect(performance.now() - started).toBeLessThan(2_000)
    expect(gfm().parse(`${'x'.repeat(10_000)}<input>\n\n`.repeat(50))).not.toContain('<input')
    expect(gfm().parse(`${'x'.repeat(1 << 20)}${'<input>'.repeat(500)}`)).not.toContain('<input')
  })
})
