import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { parse } from '../../src/index.js'
import { parse as parseCommonmark } from '../../src/presets/commonmark.js'
import {
  EXPECTED_PASSING_COMMONMARK_EXAMPLES,
  ORIGINAL_PASSING_COMMONMARK_EXAMPLES,
  COMMONMARK_SECURITY_DIFFERENCES,
} from '../fixtures/commonmark-passing.js'

interface CommonMarkExample { markdown: string; html: string; section: string; number: number }
const require = createRequire(import.meta.url)
const commonmark = require('commonmark-spec') as { tests: CommonMarkExample[] }
// The npm fixture extractor leaves the spec's visible tab markers intact.
const examples = commonmark.tests.map(example => ({ ...example,
  markdown: example.markdown.replace(/→/g, '\t'), html: example.html.replace(/→/g, '\t'),
}))
const options = { allowHtml: true, gfm: false, lazyImages: false } as const
function normalizeHtml(html: string): string {
  return html.replace(/<(br|hr)(?: \/)>/g, '<$1>')
    .replace(/<img([^>]*?) \/>/g, '<img$1>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
}

describe('CommonMark 0.31.2 compatibility', () => {
  it('loads all 652 fixtures and expands visible tab markers', () => {
    expect(examples).toHaveLength(652)
    expect(examples[0].markdown).toBe('\tfoo\tbaz\t\tbim\n')
    expect(examples.at(-1)?.number).toBe(652)
  })

  it.each(examples)('$number — $section', (example) => {
    const policyOutput = COMMONMARK_SECURITY_DIFFERENCES[example.number as keyof typeof COMMONMARK_SECURITY_DIFFERENCES]
    const expected = policyOutput ?? example.html
    expect(normalizeHtml(parse(example.markdown, options))).toBe(normalizeHtml(expected))
    expect(normalizeHtml(parseCommonmark(example.markdown, options))).toBe(normalizeHtml(expected))
  })

  it('preserves the original passing cases and checks the exact current passing set', () => {
    const passed = examples.filter(example => normalizeHtml(parse(example.markdown, options)) === normalizeHtml(example.html))
      .map(example => example.number)
    expect(passed).toEqual(EXPECTED_PASSING_COMMONMARK_EXAMPLES)
    expect(passed).toHaveLength(648)
    for (const number of ORIGINAL_PASSING_COMMONMARK_EXAMPLES) expect(passed).toContain(number)
    expect(passed).toContain(10) // Additional passing example after correcting the tab harness.
  })
})
