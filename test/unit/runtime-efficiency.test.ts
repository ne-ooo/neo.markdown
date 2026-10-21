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

describe('inline parsing without syntax indexes', () => {
  it.each([
    ['**bold &amp;** with *italic* and \\*literal\\*.', '<p><strong>bold &amp;</strong> with <em>italic</em> and *literal*.</p>\n'],
    ['***nested*** and unmatched **end', '<p><em><strong>nested</strong></em> and unmatched **end</p>\n'],
    ['Visit https://example.com for **help**.', '<p>Visit <a href="https://example.com">https://example.com</a> for <strong>help</strong>.</p>\n'],
  ])('preserves rendering for %s', (source, html) => {
    expect(createParser({ gfm: true, breaks: true, allowHtml: true }).parse(source)).toBe(html)
  })

  it('preserves indexed syntax between repeated emphasis-only calls', () => {
    const parser = createParser({ gfm: true, breaks: true, allowHtml: true })
    const indexedCases = [
      ['**contact** user@example.com and ~~old~~', '<p><strong>contact</strong> <a href="mailto:user@example.com">user@example.com</a> and <del>old</del></p>\n'],
      ['**start** [label](https://example.com "title") and `code`', '<p><strong>start</strong> <a href="https://example.com" title="title">label</a> and <code>code</code></p>\n'],
      ['**start**\nnext  \nlast', '<p><strong>start</strong><br>\nnext<br>\nlast</p>\n'],
      ['**start** <i>raw</i> and <!--comment-->', '<p><strong>start</strong> <i>raw</i> and <!--comment--></p>\n'],
      ['**start** [label][id]\n\n[id]: /target', '<p><strong>start</strong> <a href="/target">label</a></p>\n'],
    ]
    for (const [source, html] of indexedCases) {
      expect(parser.parse('**fresh**')).toBe('<p><strong>fresh</strong></p>\n')
      expect(parser.parse(source)).toBe(html)
      expect(parser.parse('**fresh**')).toBe('<p><strong>fresh</strong></p>\n')
    }
  })

  it.each([undefined, [65]])('runs stateful, reentrant custom rules with triggers %s', triggerChars => {
    let calls = 0
    const tokenizer = new InlineTokenizer([{
      name: 'replace-A', priority: 'before:text', triggerChars,
      tokenize(src) {
        if (!src.startsWith('A')) return null
        calls++
        // This nested call needs fresh link indexes while the outer call does not.
        expect(tokenizer.tokenize('[nested](/target)')[0]).toMatchObject({ type: 'link', href: '/target' })
        return { token: { type: 'code', raw: 'A', text: String(calls) }, raw: 'A' }
      },
    }])
    for (const expected of ['1', '2']) {
      expect(tokenizer.tokenize('A **value**')).toContainEqual({ type: 'code', raw: 'A', text: expected })
    }
    expect(calls).toBe(2)
  })

  it('returns independent tokens and preserves emphasis token accounting', () => {
    const tokenizer = new InlineTokenizer()
    const source = '**bold &amp;**'
    const expected = [{
      type: 'strong', raw: source, text: 'bold &amp;',
      tokens: [{ type: 'text', raw: 'bold &amp;', text: 'bold &' }],
    }]
    const budget = createTokenBudget(1)
    const tokens = tokenizer.tokenize(source, new Map(), budget)
    expect(tokens).toEqual(expected)
    expect(budget.remaining).toBe(0)
    tokens[0].text = 'changed'
    tokens[0].tokens![0].text = 'changed child'
    expect(tokenizer.tokenize(source)).toEqual(expected)
    expect(new InlineTokenizer().tokenize(source)).toEqual(expected)
    expect(() => tokenizer.tokenize(source, new Map(), budget)).toThrow(/token count/)
  })
})
