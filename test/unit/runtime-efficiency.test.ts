import { describe, expect, it } from 'vitest'
import { InlineTokenizer } from '../../src/core/inline-tokenizer.js'
import { createTokenBudget } from '../../src/core/token-budget.js'
import { createParser } from '../../src/index.js'

describe('plain-text fast path', () => {
  it('decodes entities while preserving raw text and token budgets', () => {
    const tokenizer = new InlineTokenizer()
    const src = 'ordinary &amp; &NotEqualTilde; &#128512; &unknown; text'
    const budget = createTokenBudget(1)
    expect(tokenizer.tokenize(src, new Map(), budget)).toEqual([
      { type: 'text', raw: src, text: 'ordinary & ≂̸ 😀 &unknown; text' },
    ])
    expect(budget.remaining).toBe(0)
    expect(() => tokenizer.tokenize(src, new Map(), budget)).toThrow(/token count/)
    expect(tokenizer.tokenize('', new Map(), budget)).toEqual([])
  })

  it('still dispatches custom rules before plain text', () => {
    for (const triggerChars of [undefined, [65]]) {
      const tokenizer = new InlineTokenizer([{
        name: 'replace-A', priority: 'before:text', triggerChars,
        tokenize: src => src.startsWith('A') ? { token: { type: 'code', raw: 'A', text: 'custom' }, raw: 'A' } : null,
      }])
      expect(tokenizer.tokenize('A plain sentence.')[0]).toEqual({ type: 'code', raw: 'A', text: 'custom' })
    }
  })

  it('retains GFM autolinks, line breaks, and escape precedence', () => {
    const parser = createParser({ gfm: true, breaks: true })
    expect(parser.parse('Text https://example.com\nnext \\&amp;')).toBe(
      '<p>Text <a href="https://example.com">https://example.com</a><br>\nnext &amp;amp;</p>\n'
    )
  })

  it('merges adjacent text without bypassing token accounting', () => {
    const tokenizer = new InlineTokenizer()
    const budget = createTokenBudget(1)
    expect(tokenizer.tokenize('a\\*b', new Map(), budget)).toEqual([
      { type: 'text', raw: 'a\\*b', text: 'a*b' },
    ])
    expect(budget.remaining).toBe(0)
    expect(() => tokenizer.tokenize('a\\*b', new Map(), budget)).toThrow(/token count/)
  })
})
