import { describe, expect, it } from 'vitest'
import { createParser } from '../../src/index.js'
import { createIncrementalMarkdown, defineIncrementalPlugin } from '../../src/experimental/index.js'
import { createTokenBudget, releaseTokenBudget } from '../../src/core/token-budget.js'
import type { InlineRule, InlineToken, MarkdownPlugin, TextToken } from '../../src/core/types.js'

/** A token whose children are a token twice, `levels` deep, above a text token. */
function shared(levels: number, text: string): InlineToken {
  let token: InlineToken = { type: 'text', raw: text, text }
  for (let level = 0; level < levels; level++) token = { type: 'strong', raw: '@', text: '@', tokens: [token, token] }
  return token
}

/** A plugin whose rule on `@` returns the same token every time. */
const at = (token: InlineToken): MarkdownPlugin => builder => builder.addInlineRule({
  name: 'at', priority: 1, triggerChars: [64], tokenize: (src) => (src.startsWith('@') ? { raw: '@', token } : null),
})

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
  it('refuses a custom token that shares its children once it passes the limit', () => {
    const parser = createParser({ maxTokens: 1_000, plugins: [at(shared(60, 'x'))] })

    expect(() => parser.parse('a @')).toThrow(new RangeError('Markdown token count exceeds maxTokens 1000'))
  })

  it('refuses a custom token that holds itself, with or without limits', () => {
    const token = { type: 'strong', raw: '@', text: '@', tokens: [] as InlineToken[] } satisfies InlineToken
    token.tokens.push(token)

    for (const options of [{ maxTokens: 1_000 }, { maxOutputLength: 100 }, {}]) {
      expect(() => createParser({ ...options, plugins: [at(token)] }).parse('a @'))
        .toThrow(new TypeError('Cyclic token graph is not renderable'))
    }
  })

  // With only an output limit, alt text and emphasis walked every path
  // through a shared token: 2^26 of them for alt text that is empty.
  it.each([
    ['alt text', '![@](x)'],
    ['emphasis', '*a* @'],
    ['link text', '[a @](u)'],
  ])('refuses a custom token that expands past the output limit in %s', (_, markdown) => {
    const parser = createParser({ maxOutputLength: 100, plugins: [at(shared(26, ''))] })
    const started = performance.now()

    expect(() => parser.parse(markdown)).toThrow(new RangeError("Custom inline tokens' descendants exceed maxOutputLength 100"))
    expect(performance.now() - started).toBeLessThan(500)
  })

  // Alt text from the Markdown itself counted against the output limit
  // each time it was built, including in link text that was then rejected.
  it('does not count alt text from the Markdown itself against the output limit', () => {
    const markdown = `[![${'a'.repeat(1_000)}](x) [a](u)](v)`
    const html = createParser().parse(markdown)

    expect(html.length).toBeLessThan(1_100)
    expect(createParser({ maxOutputLength: 1_100 }).parse(markdown)).toBe(html)
  })

  // Each image counted, read and released the same large token again:
  // 10,000 of them took four seconds. Its measure is read once.
  it.each([
    ['one paragraph', '![!](u) '],
    ['separate paragraphs', '![!](u)\n\n'],
  ])('reads a large custom token once for every image holding it, in %s', (_, image) => {
    let token: InlineToken = { type: 'text', raw: '', text: '' }
    for (let level = 0; level < 13; level++) token = { type: 'strong', raw: '!', text: '!', tokens: [token, token] }
    const parser = createParser({
      maxTokens: 50_000,
      plugins: [builder => builder.addInlineRule({
        name: 'bang', priority: 1, triggerChars: [33], tokenize: (src) => (src.startsWith('!') && !src.startsWith('![') ? { raw: '!', token } : null),
      })],
    })
    const started = performance.now()

    expect(parser.parse(image.repeat(10_000)).match(/<img src="u" alt=""/g)).toHaveLength(10_000)
    expect(performance.now() - started).toBeLessThan(1_000)
  })

  // Link text holding a link is tokenized again, 2^(d - 1) times for d
  // levels, so charges that never returned refused a 61-character document.
  it.each([
    ['UGC mode, a token of 300 children', { ugc: true }, { type: 'strong', raw: '@', text: '@', tokens: Array.from({ length: 300 }, () => ({ type: 'text', raw: 'x', text: 'x' })) }],
    ['an output limit, a token of 2,000 characters', { maxOutputLength: 1 << 20 }, { type: 'text', raw: '@', text: 'x'.repeat(2_000) }],
  ] as const)('accepts nested link text tokenized again, with %s', (_, options, token) => {
    for (const inner of ['@', '![@](i)']) {
      const markdown = `${'['.repeat(12)}${inner}${'](u)'.repeat(12)}`
      const plugins = [at(token as InlineToken)]

      expect(createParser({ ...options, plugins }).parse(markdown)).toBe(createParser({ plugins }).parse(markdown))
    }
  })

  // Without a token limit, emphasis measured a token's depth by walking all
  // of it, for ever on a token that holds itself.
  it('stops measuring a custom token that holds itself past the nesting limit', () => {
    const token = { type: 'strong', raw: '@', text: '@', tokens: [] as InlineToken[] } satisfies InlineToken
    token.tokens.push(token)

    expect(() => createParser({ plugins: [at(token)] }).parse('*a* @')).toThrow(new TypeError('Cyclic token graph is not renderable'))
  })

  // Alt text memoized for each token in a custom token kept the whole text
  // under each, and charges that never returned refused images in link text
  // tokenized again, or missed inner images' text.
  it.each([
    ['a long text under 200 levels', { ugc: true }, '![@](u)', () => {
      let token: InlineToken = { type: 'text', raw: '@', text: 'y'.repeat(2_000_000) }
      for (let level = 0; level < 200; level++) token = { type: 'strong', raw: '@', text: '@', tokens: [token, { type: 'text', raw: 'x', text: 'x' }] }
      return token
    }],
    ['ten nested images', { maxOutputLength: 1_100 }, Array.from({ length: 10 }).reduce<string>(inner => `![${inner}a](u)`, '@'), () => ({ type: 'text', raw: '@', text: 'x'.repeat(1_000) }) as InlineToken],
    ['an image in link text tokenized again', { maxOutputLength: 10_000 }, `${'['.repeat(7)}![@](i)${'](u)'.repeat(7)}`, () => ({ type: 'text', raw: '@', text: 'x'.repeat(1_000) }) as InlineToken],
  ])('renders alt text from %s as without limits', (_, options, markdown, build) => {
    const token = build()

    expect(createParser({ ...options, plugins: [at(token)] }).parse(markdown)).toBe(createParser({ plugins: [at(token)] }).parse(markdown))
  })

  // A rule's token at a line break was charged, then dropped for the hard
  // break without returning its charge.
  it('returns nothing it never charged at a hard break', () => {
    const em = (): InlineToken => ({ type: 'em', raw: '\n', text: '', tokens: Array.from({ length: 100 }, () => ({ type: 'text' as const, raw: 'y', text: 'y' })) })
    const plugins: MarkdownPlugin[] = [
      builder => builder.addInlineRule({ name: 'at', priority: 1, triggerChars: [64], tokenize: (src) => (src.startsWith('@  ') ? { raw: '@  ', token: { type: 'text', raw: '@  ', text: 'a  ' } } : null) }),
      builder => builder.addInlineRule({ name: 'nl', priority: 1, triggerChars: [10], tokenize: (src) => (src.startsWith('\n') ? { raw: '\n', token: em() } : null) }),
    ]
    const markdown = '@  \nx '.repeat(30)

    expect(createParser({ maxOutputLength: 2_000, plugins }).parse(markdown)).toBe(createParser({ plugins }).parse(markdown))
  })

  // Trimming a line's trailing spaces copied a rule's token, and the copy
  // didn't return its children's charge when discarded.
  it('returns the charge of a trimmed copy of a token with children', () => {
    const plugin: MarkdownPlugin = builder => builder.addInlineRule({
      name: 'at', priority: 1, triggerChars: [64],
      tokenize: (src) => (src.startsWith('@  ')
        ? { raw: '@  ', token: { type: 'text', raw: '@  ', text: 'a  ', tokens: Array.from({ length: 100 }, () => ({ type: 'text' as const, raw: '', text: '' })) } as InlineToken }
        : null),
    })
    const markdown = '![@  \nx](u)\n\n'.repeat(60)

    expect(createParser({ maxOutputLength: 5_000, plugins: [plugin] }).parse(markdown)).toBe(createParser({ plugins: [plugin] }).parse(markdown))
  })

  // A new token for every image was measured into a map that kept them all.
  it('measures a new token for each of 20,000 images', () => {
    const plugin: MarkdownPlugin = builder => builder.addInlineRule({
      name: 'at', priority: 1, triggerChars: [64],
      tokenize: (src) => (src.startsWith('@')
        ? { raw: '@', token: { type: 'strong', raw: '@', text: '@', tokens: Array.from({ length: 100 }, () => ({ type: 'text' as const, raw: '', text: '' })) } }
        : null),
    })

    expect(createParser({ ugc: true, plugins: [plugin] }).parse('![@](u) '.repeat(20_000)).match(/<img /g)).toHaveLength(20_000)
  })

  // Merging and trimming spread a rule's token into a plain object, which
  // dropped the getters of a class instance.
  it('copies a rule token that is a class instance with its getters', () => {
    class Leaf { raw = '@'; text = 'L'; get type() { return 'text' as const } }
    class Spaced { raw = '@  '; text = 'C  '; get type() { return 'text' as const } }
    const leaf = createParser({ plugins: [at(new Leaf() as unknown as InlineToken)] })
    const spaced = createParser({ plugins: [builder => builder.addInlineRule({
      name: 'at', priority: 1, triggerChars: [64], tokenize: (src) => (src.startsWith('@  ') ? { raw: '@  ', token: new Spaced() as unknown as InlineToken } : null),
    })] })

    expect(leaf.parse('@b')).toBe('<p>Lb</p>\n')
    expect(leaf.parse('@ b')).toBe('<p>L b</p>\n')
    expect(spaced.parse('@  \nx')).toBe('<p>C<br>\nx</p>\n')
    expect(spaced.parse('![@  \nx](u)')).toContain('alt="C\nx"')
  })

  // Alt text from the Markdown itself counted against the output limit,
  // though a renderer or a transform may drop images, and tokenizing renders
  // nothing.
  it('counts only custom text in alt text against the output limit', () => {
    const markdown = `![${'a'.repeat(300)}](u) and text`
    const dropped = createParser({ maxOutputLength: 200, renderer: { image: () => '<img>' } })

    expect(dropped.parse(markdown)).toBe('<p><img> and text</p>\n')
    expect(() => createParser({ maxOutputLength: 200 }).tokenize(markdown)).not.toThrow()
  })

  // Measures were kept for good, so a token a transform changed after one
  // document kept the measure of what it was.
  it('measures a token again in each document', () => {
    const token: TextToken = { type: 'text', raw: '@', text: '' }
    const parser = createParser({
      plugins: [at(token), builder => builder.addTokenTransform(tokens => { token.text = 'visible'; return tokens })],
    })

    expect(parser.parse('@')).toBe('<p>visible</p>\n')
    expect(parser.parse('![@](u)')).toContain('alt="visible"')
  })

  // Each paragraph an incremental session tokenized started a new
  // allowance, and a reused one spent none.
  it('keeps one allowance for a document in an incremental session', () => {
    const token: InlineToken = { type: 'strong', raw: '@', text: '@', tokens: [{ type: 'text', raw: '@', text: 'x'.repeat(100) }] }
    const plugin = defineIncrementalPlugin(at(token), { protocol: 1, id: 'at', profile: 'inline', effects: 'none', dependencies: { kind: 'static' } })
    const options = { maxOutputLength: 150, plugins: [plugin] }
    const refusal = new RangeError('Custom text in image alt text exceeds maxOutputLength 150')
    const both = '![@](x)\n\n![@](y)'

    expect(() => createParser(options).parse(both)).toThrow(refusal)
    expect(() => createIncrementalMarkdown({ pluginReuse: 'declared', parser: options }).update(both)).toThrow(refusal)
    const session = createIncrementalMarkdown({ pluginReuse: 'declared', parser: options })
    session.update('![@](x)')
    expect(() => session.update(both)).toThrow(refusal)
  })

  // Each image's alt text copied the token's text: 10,000 images ran out of
  // memory before the rendered HTML met its limit.
  it('counts the text of custom tokens against the output limit as they are built', () => {
    const token: InlineToken = {
      type: 'strong', raw: '@', text: '@',
      tokens: [{ type: 'text', raw: 'x', text: 'x'.repeat(100_000) }, { type: 'text', raw: 'y', text: 'y'.repeat(100_000) }],
    }
    const parser = createParser({ ugc: true, plugins: [at(token)] })
    const started = performance.now()

    expect(() => parser.parse('![@](x) '.repeat(10_000))).toThrow(new RangeError('Custom text in image alt text exceeds maxOutputLength 20000000'))
    expect(performance.now() - started).toBeLessThan(1_000)
    expect(parser.parse('![@](x) '.repeat(3)).match(/alt="x{100000}y{100000}"/g)).toHaveLength(3)
    expect(() => createParser({ maxOutputLength: 50, plugins: [at(token)] }).parse('![@](x)')).toThrow(RangeError)
  })

  // A length that isn't a number never passed the limit.
  it('refuses a custom token whose children are not an array', () => {
    const token = { type: 'strong', raw: '@', text: '@', tokens: new Set<unknown>() }
    token.tokens.add(token)

    expect(() => createParser({ maxTokens: 1_000, plugins: [at(token as unknown as InlineToken)] }).parse('a @'))
      .toThrow(new TypeError('Inline token children must be an array'))
  })

  it('never returns more to the budget than its limit', () => {
    const budget = createTokenBudget(10, 'maxTokens')
    releaseTokenBudget(budget, 5)

    expect(budget.remaining).toBe(10)
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
