import { Parser } from 'htmlparser2'
import { describe, expect, it } from 'vitest'
import { assertHtmlNesting, htmlNestingDepth, MAX_HTML_NESTING_DEPTH } from '../../src/sanitizers/nesting.js'
import { createParser } from '../../src/sanitized.js'

/** The deepest htmlparser2's own parser, behind sanitize-html, gets. */
function parserDepth(html: string): number {
  let deepest = 0
  const parser: Parser = new Parser({
    onopentagname() {
      deepest = Math.max(deepest, (parser as unknown as { stack: string[] }).stack.length)
    },
  }, { decodeEntities: true })
  parser.write(html)
  parser.end()
  return deepest
}

function random(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

const TAGS = [
  'div', 'span', 'p', 'li', 'ul', 'ol', 'table', 'tr', 'td', 'th', 'thead', 'tbody', 'tfoot',
  'a', 'form', 'input', 'select', 'option', 'optgroup', 'dd', 'dt', 'dl', 'h1', 'h2', 'svg',
  'math', 'g', 'foreignObject', 'foreignobject', 'clipPath', 'title', 'desc', 'mi', 'mtext',
  'annotation-xml', 'image', 'img', 'br', 'hr', 'pre', 'blockquote', 'details', 'button',
  'DIV', 'Svg', 'textarea', 'script', 'style', 'xmp', 'iframe', 'noembed', 'plaintext', 'body',
]

/** Tag soup with the constructs whose bounds the parser decides. */
function tagSoup(next: () => number, parts: number): string {
  const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)]!
  let html = ''
  for (let part = 0; part < parts; part++) {
    const roll = next()
    const tag = pick(TAGS)
    if (roll < 0.4) {
      const attribute = pick(['', ' id=x', ' title="a > </div>"', " alt='</span><div>'", ' data-x=a>b'])
      html += `<${tag}${attribute}${next() < 0.15 ? '/' : ''}>`
    } else if (roll < 0.7) {
      html += `</${tag}>`
    } else if (roll < 0.76) {
      html += pick(['<!-- <div> </span> -->', '<!--->', '<!-->', '<!-- --!> <div>', '<!--x'])
    } else if (roll < 0.82) {
      html += pick(['<![CDATA[ > </div></div><div> ]]>', '<![CDATA[x]]>', '<!DOCTYPE html>', '<?xml ?>'])
    } else {
      html += pick(['text', ' < 3 ', '&amp;', '\n', 'a</', '<', '<1>', '</ div>'])
    }
  }
  return html
}

describe('HTML nesting depth', () => {
  // The bound holds only if this measures what the parser reaches: a lower
  // depth would let crafted HTML reach the parser's quadratic cost again.
  it('matches the depth htmlparser2 reaches, across tag soup', () => {
    const next = random(20261108)
    const mismatches: string[] = []
    for (let sample = 0; sample < 3_000; sample++) {
      const html = tagSoup(next, 5 + Math.floor(next() * 120))
      if (htmlNestingDepth(html) !== parserDepth(html)) mismatches.push(html)
    }

    expect(mismatches.slice(0, 3)).toEqual([])
  })

  it.each([
    ['implied end tags', '<ul><li><p>a<p>b<li>c<table><tr><td>1<td>2<tr><td>3</table></ul>'],
    ['end tags inside SVG character data', `<div><svg><![CDATA[ > ${'</div>'.repeat(5)} ]]>${'<g>'.repeat(5)}`],
    ['self-closing tags in foreign content', '<svg><g/><g/><foreignObject><div/><div/></foreignObject></svg>'],
    ['end tags inside raw text', `<div><script>${'</div>'.repeat(5)}</script><textarea>${'<div>'.repeat(5)}</textarea>`],
    ['a second form', '<form><div><form><div>'],
    ['an end tag with nothing to close', '</p></div><div></p></br>'],
  ])('matches htmlparser2 on %s', (_, html) => {
    expect(htmlNestingDepth(html)).toBe(parserDepth(html))
  })

  it('accepts HTML as deep as the limit, and refuses one level deeper', () => {
    const nested = (depth: number) => '<span>'.repeat(depth) + '</span>'.repeat(depth)

    expect(() => assertHtmlNesting(nested(MAX_HTML_NESTING_DEPTH))).not.toThrow()
    expect(() => assertHtmlNesting(nested(MAX_HTML_NESTING_DEPTH + 1))).toThrow(
      new RangeError(`HTML nesting exceeds ${MAX_HTML_NESTING_DEPTH} elements`),
    )
  })

  // The parser moved every open element on each new one: 1 MB of open
  // tags took 6 to 14 seconds to sanitize.
  it.each([
    ['open', '<div>'.repeat(200_000)],
    ['open inline', '<span>'.repeat(170_000)],
    ['closed', `${'<div>'.repeat(100_000)}x${'</div>'.repeat(100_000)}`],
  ])('refuses 1 MB of %s nested tags before sanitizing them', (_, html) => {
    expect(() => createParser({ allowHtml: true, sanitize: true }).parse(html)).toThrow(
      new RangeError(`HTML nesting exceeds ${MAX_HTML_NESTING_DEPTH} elements`),
    )
  })

  it('sanitizes nested HTML within the limit as before', () => {
    const parser = createParser({ allowHtml: true, sanitize: true })

    expect(parser.parse('<details><summary>s</summary><div><div><b>x</b></div></div></details>')).toBe(
      '<details><summary>s</summary><div><div><b>x</b></div></div></details>\n',
    )
  })
})
