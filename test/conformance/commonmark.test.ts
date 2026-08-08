import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { parse } from '../../src/index.js'

interface CommonMarkExample {
  markdown: string
  html: string
  section: string
  number: number
}

const require = createRequire(import.meta.url)
const commonmark = require('commonmark-spec') as {
  tests: CommonMarkExample[]
}

function normalizeHtml(html: string): string {
  return html
    .replace(/<(br|hr)(?: \/)>/g, '<$1>')
    .replace(/<img([^>]*?) \/>/g, '<img$1>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

describe('CommonMark 0.31.2 conformance floor', () => {
  it('loads the complete official fixture set', () => {
    expect(commonmark.tests).toHaveLength(652)
    expect(commonmark.tests[0]?.number).toBe(1)
    expect(commonmark.tests.at(-1)?.number).toBe(652)
  })

  it('does not regress the documented Markdown-subset baseline', () => {
    const passed = commonmark.tests.filter((example) => {
      const actual = parse(example.markdown, {
        allowHtml: true,
        gfm: false,
        lazyImages: false,
      })
      return normalizeHtml(actual) === normalizeHtml(example.html)
    })

    expect(passed.length).toBeGreaterThanOrEqual(284)
  })
})
