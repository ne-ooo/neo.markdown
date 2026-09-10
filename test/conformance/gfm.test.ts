import { describe, expect, it } from 'vitest'
import { parse } from '../../src/index.js'
import { parse as parseGfm } from '../../src/presets/gfm.js'
import corpus from '../fixtures/gfm-official.json'

// GFM 0.29-gfm, CC-BY-SA-4.0. See THIRD_PARTY_NOTICES.md.
// Normalize quote entities and the two exact equivalent checkbox serializations.
function normalize(html: string): string {
  return html.replaceAll("&#39;", "'").replaceAll('<input disabled="" type="checkbox">', '<input type="checkbox" disabled>')
    .replaceAll('<input checked="" disabled="" type="checkbox">', '<input type="checkbox" checked disabled>')
}
const policyExamples = new Set([633, 634, 635])
function expected(html: string, example: number): string {
  return policyExamples.has(example)
    ? html.replace(/<a href="xmpp:[^"]*">([^<]*)<\/a>/g, '$1')
    : html
}

describe('all 28 normative GFM 0.29 extension examples', () => {
  it('pins the complete extension corpus and its policy exceptions', () => {
    expect(corpus.examples).toHaveLength(28)
    expect(corpus.examples.filter(f => policyExamples.has(f.example)).map(f => f.example)).toEqual([633, 634, 635])
  })
  for (const fixture of corpus.examples) {
    it(`${fixture.example}: ${fixture.section}${policyExamples.has(fixture.example) ? ' (XMPP URL policy)' : ''}`, () => {
      const actual = parse(fixture.markdown, { gfm: true, allowHtml: true, lazyImages: false })
      expect(normalize(actual)).toBe(normalize(expected(fixture.html, fixture.example)))
      expect(parseGfm(fixture.markdown, { allowHtml: true, lazyImages: false, breaks: false })).toBe(actual)
      if (policyExamples.has(fixture.example)) expect(normalize(actual)).not.toBe(normalize(fixture.html))
    })
  }
})
