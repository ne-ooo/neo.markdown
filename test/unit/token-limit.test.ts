import { createRequire } from 'node:module'
import { describe, expect, it, vi } from 'vitest'
import { InlineTokenizer } from '../../src/core/inline-tokenizer.js'
import { gfmInlineSupport } from '../../src/inline/gfm-support.js'
import { createTokenBudget } from '../../src/core/token-budget.js'
import type { InlineToken } from '../../src/core/types.js'
import { createIncrementalMarkdown } from '../../src/experimental/incremental.js'
import { createParser } from '../../src/index.js'
import { createParser as createSanitizedParser } from '../../src/sanitized.js'
import gfm from '../fixtures/gfm-official.json'

const require = createRequire(import.meta.url)
const commonmark = require('commonmark-spec').tests as Array<{ markdown: string }>
const countTokens = (tokens: InlineToken[]): number =>
  tokens.reduce((count, token) => count + 1 + ('tokens' in token ? countTokens(token.tokens) : 0), 0)

const wideTable = (columns: number, rows: number) =>
  `${'|a'.repeat(columns)}|\n${'|-'.repeat(columns)}|\n${'b\n'.repeat(rows)}`

describe('maxTokens', () => {
  // 1 MiB of emphasis builds about 790,000 tokens.
  it('stops a document of emphasis before building its tokens', () => {
    const parser = createParser({ maxTokens: 10_000 })

    expect(() => parser.parse('*a* '.repeat(262_144))).toThrow(
      new RangeError('Markdown token count exceeds maxTokens 10000'),
    )
  })

  // Each short row is padded to the header's width while the table is
  // tokenized: 26 KB of rows under 1,000 columns makes 10 million cells.
  it('counts the cells a short row is padded with before building them', () => {
    const parser = createParser({ gfm: true, maxTokens: 10_000 })

    expect(() => parser.parse(wideTable(1_000, 10_000))).toThrow(
      new RangeError('Markdown token count exceeds maxTokens 10000'),
    )
    expect(() => parser.parse(wideTable(1_000, 4))).not.toThrow()
  })

  it('renders a document within the limit as an unlimited parser does', () => {
    const markdown = '# T\n\n> *quote* [l](https://x.y)\n\n- a\n- **b**\n\n| a | b |\n|---|---|\n| 1 |\n'
    const html = createParser({ gfm: true }).parse(markdown)

    expect(createParser({ gfm: true, maxTokens: 1_000 }).parse(markdown)).toBe(html)
    expect(() => createParser({ gfm: true, maxTokens: 10 }).parse(markdown)).toThrow(RangeError)
  })

  it('applies with the sanitized entry and raw HTML allowed', () => {
    const parser = createSanitizedParser({ allowHtml: true, sanitize: true, maxTokens: 1_000 })

    expect(parser.parse('<p align="center">*hi*</p>\n\n*a*')).toContain('<em>a</em>')
    expect(() => parser.parse('*a* '.repeat(10_000))).toThrow(/exceeds maxTokens 1000/)
  })

  it('lowers the UGC limit, but cannot raise it', () => {
    const source = '**text**\n\n'.repeat(18_000)

    expect(() => createParser({ ugc: true, maxTokens: 100 }).parse('*a* '.repeat(100))).toThrow(
      new RangeError('Markdown token count exceeds maxTokens 100'),
    )
    expect(() => createParser({ ugc: true, maxTokens: 1_000_000 }).parse(source)).toThrow(
      new RangeError('Markdown token count exceeds UGC limit 50000'),
    )
  })

  it('keeps the limit when an incremental session reuses cached tokens', () => {
    const session = createIncrementalMarkdown({ parser: { maxTokens: 1_000 }, maxWorkCodeUnits: 10_000_000 })
    session.update('**text**')

    expect(() => session.update('**text**\n\n'.repeat(400))).toThrow(/exceeds maxTokens 1000/)
  })

  // Inline pieces were counted only once emphasis resolved and adjacent text
  // merged: 1 MiB of emphasis built a million of them, hundreds of megabytes,
  // before the first was counted. They now count as they are built, and
  // return to the budget as they merge or are used up.
  it('counts inline pieces as they are built', () => {
    const tokenizer = new InlineTokenizer()
    const budget = createTokenBudget(1_000)

    expect(() => tokenizer.tokenize('*a* '.repeat(262_144), new Map(), budget)).toThrow(
      new RangeError('Markdown token count exceeds UGC limit 1000'),
    )
    expect(budget.remaining).toBe(0)
  })

  it.each([
    ['CommonMark', commonmark],
    ['GFM', gfm.examples],
  ])('charges exactly the inline tokens it returns, across the %s examples', (_, examples) => {
    const tokenizer = new InlineTokenizer()
    const mismatches = examples.flatMap(({ markdown }) => {
      const budget = createTokenBudget(1_000_000)
      const tokens = tokenizer.tokenize(markdown, new Map(), budget)
      const charged = 1_000_000 - budget.remaining
      return charged === countTokens(tokens) ? [] : [markdown]
    })

    expect(mismatches).toEqual([])
  })

  // Every email link in a paragraph was built while the paragraph was
  // scanned, before any was counted: 166,666 addresses built 333,332 tokens.
  it('counts an email link when it is built', () => {
    const tokenizer = new InlineTokenizer([], { gfm: true })
    const budget = createTokenBudget(10)
    const built = vi.spyOn(gfmInlineSupport, 'emailLink')

    expect(() => tokenizer.tokenize('a@b.c '.repeat(166_666), new Map(), budget)).toThrow(RangeError)
    expect(built.mock.calls.length).toBeLessThanOrEqual(10)
    built.mockRestore()
  })

  // A custom rule's token was charged for itself alone, but discarding it, as
  // in alt text, released its children too: a 10-token budget grew to 109.
  it("charges a custom rule's children, and releases what it charged", () => {
    const children = Array.from({ length: 100 }, () => ({ type: 'text' as const, raw: 'x', text: 'x' }))
    const tokenizer = new InlineTokenizer([{
      name: 'dollar',
      triggerChars: [36],
      tokenize: (src) => (src.startsWith('$') ? { raw: '$', token: { type: 'em', raw: '$', text: '$', tokens: children } } : null),
    }])
    const budget = createTokenBudget(1_000)

    expect(tokenizer.tokenize('![$](x)', new Map(), budget)).toMatchObject([{ type: 'image', text: 'x'.repeat(100) }])
    expect(budget.remaining).toBe(999)
    expect(() => tokenizer.tokenize('$', new Map(), createTokenBudget(100))).toThrow(RangeError)
  })

  it.each([-1, 1.5, Number.NaN, Infinity])('rejects maxTokens %s', (maxTokens) => {
    expect(() => createParser({ maxTokens })).toThrow(
      new TypeError('maxTokens must be a non-negative safe integer'),
    )
  })
})
