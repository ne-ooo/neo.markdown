import { describe, expect, it } from 'vitest'
import { createParser } from '../../src/index.js'
import type { InlineRule, InlineToken, TextToken } from '../../src/core/types.js'

/** A rule on `!` returning an emphasis of 200 pieces of text. */
function wideEmphasis(priority: number): InlineRule {
  return {
    name: 'bang',
    priority,
    triggerChars: [33],
    tokenize: (src) => (src.startsWith('!') && !src.startsWith('![')
      ? { raw: '!', token: { type: 'em', raw: '!', text: '!', tokens: Array.from({ length: 200 }, () => ({ type: 'text' as const, raw: 'x', text: 'x' })) } }
      : null),
  }
}

describe('custom inline rules and the token budget', () => {
  // Rules ranked after text were charged for their token alone, but alt text
  // that the result discards released their children too, so the budget
  // grew past its limit.
  it.each([1, -1])('charges a custom token with its children at priority %i', (priority) => {
    const parser = createParser({ maxTokens: 2_000, plugins: [builder => builder.addInlineRule(wideEmphasis(priority))] })

    expect(() => parser.parse(`![${'!'.repeat(50)}](u) ${'x * '.repeat(3_000)}`)).toThrow(RangeError)
    expect(() => createParser({ maxTokens: 2_000 }).parse('x * '.repeat(3_000))).toThrow(RangeError)
  })

  // Counting went over a shared child once per path to it: 2^60 here.
  it.each([
    ['shares its children', () => {
      let token: InlineToken = { type: 'text', raw: 'x', text: 'x' }
      for (let level = 0; level < 60; level++) token = { type: 'strong', raw: '!', text: '!', tokens: [token, token] }
      return token
    }],
    ['holds itself', () => {
      const token = { type: 'strong', raw: '!', text: '!', tokens: [] as InlineToken[] } satisfies InlineToken
      token.tokens.push(token)
      return token
    }],
  ])('refuses a custom token that %s once it passes the limit', (_, build) => {
    const token = build()
    const parser = createParser({
      maxTokens: 1_000,
      plugins: [builder => builder.addInlineRule({
        name: 'bang', priority: 1, triggerChars: [33], tokenize: (src) => (src.startsWith('!') ? { raw: '!', token } : null),
      })],
    })

    expect(() => parser.parse('a !')).toThrow(new RangeError('Markdown token count exceeds maxTokens 1000'))
  })

  // Alt text returns its tokens to the budget, so each image could count and
  // read the same large token again: 10,000 of them took four seconds.
  it.each([
    ['one paragraph', '![!](u) '],
    ['separate paragraphs', '![!](u)\n\n'],
  ])('refuses a custom token counted again for each image, in %s', (_, image) => {
    let token: InlineToken = { type: 'text', raw: '', text: '' }
    for (let level = 0; level < 13; level++) token = { type: 'strong', raw: '!', text: '!', tokens: [token, token] }
    const parser = createParser({
      maxTokens: 50_000,
      plugins: [builder => builder.addInlineRule({
        name: 'bang', priority: 1, triggerChars: [33], tokenize: (src) => (src.startsWith('!') && !src.startsWith('![') ? { raw: '!', token } : null),
      })],
    })
    const started = performance.now()

    expect(() => parser.parse(image.repeat(10_000))).toThrow(
      new RangeError('Custom inline tokens\' children exceed 4 times maxTokens 50000'),
    )
    expect(performance.now() - started).toBeLessThan(1_000)
    expect(parser.parse(image.repeat(3)).match(/<img src="u" alt=""/g)).toHaveLength(3)
  })

  // Adjacent text was merged by appending to the token before it, which
  // changed a token a custom rule returns every time.
  it.each([1, -1])('leaves a shared token from a custom rule as it was at priority %i', (priority) => {
    const shared: TextToken = { type: 'text', raw: '!', text: '(bang)' }
    const parser = createParser({
      plugins: [builder => builder.addInlineRule({
        name: 'bang', priority, triggerChars: [33], tokenize: (src) => (src.startsWith('!') ? { raw: '!', token: shared } : null),
      })],
    })

    expect(parser.parse('!b c')).toBe('<p>(bang)b c</p>\n')
    expect(parser.parse('!')).toBe('<p>(bang)</p>\n')
    expect(shared).toEqual({ type: 'text', raw: '!', text: '(bang)' })
  })

  // A line's trailing spaces were trimmed from the token before its break in
  // place, which could be a token a custom rule returns every time.
  it('leaves a shared token from a custom rule as it was when its line breaks', () => {
    const shared: TextToken = { type: 'text', raw: '!  ', text: 'bang  ' }
    const parser = createParser({
      plugins: [builder => builder.addInlineRule({
        name: 'bang', priority: 1, triggerChars: [33], tokenize: (src) => (src.startsWith('!  ') ? { raw: '!  ', token: shared } : null),
      })],
    })

    expect(parser.parse('!  \nx')).toBe('<p>bang<br>\nx</p>\n')
    expect(parser.parse('!  z')).toBe('<p>bang  z</p>\n')
    expect(shared).toEqual({ type: 'text', raw: '!  ', text: 'bang  ' })
  })
})
