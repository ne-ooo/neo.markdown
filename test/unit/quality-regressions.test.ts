import { describe, expect, it } from 'vitest'
import { createParser } from '../../src/index.js'
import { createParser as createSelectiveParser } from '../../src/core/parser.js'
import { heading, paragraph } from '../../src/blocks/index.js'
import type { BlockToken, MarkdownPlugin } from '../../src/core/types.js'

describe('parser quality regressions', () => {
  it('builds a selective parser from only explicitly imported block rules', () => {
    const parser = createSelectiveParser({ blocks: [heading, paragraph] })

    expect(parser.parse('# Included')).toBe('<h1>Included</h1>\n')
    expect(parser.parse('```js\nnot included\n```')).not.toContain('<pre>')
  })

  it('rejects block rules that do not consume input', () => {
    const plugin: MarkdownPlugin = (builder) => {
      builder.addBlockRule({
        name: 'empty',
        priority: 1000,
        tokenize(src) {
          return {
            token: { type: 'paragraph', raw: '', text: src, tokens: [] },
            raw: '',
          }
        },
      })
    }

    expect(() => createParser({ plugins: [plugin] }).parse('input')).toThrow(
      'must consume a non-empty prefix'
    )
  })

  it('rejects block rules that return a non-prefix raw value', () => {
    const plugin: MarkdownPlugin = (builder) => {
      builder.addBlockRule({
        name: 'non-prefix',
        priority: 1000,
        tokenize() {
          return {
            token: { type: 'paragraph', raw: 'other', text: 'other', tokens: [] },
            raw: 'other',
          }
        },
      })
    }

    expect(() => createParser({ plugins: [plugin] }).parse('input')).toThrow(
      'is not a source prefix'
    )
  })

  it('rejects inline rules that do not consume input', () => {
    const plugin: MarkdownPlugin = (builder) => {
      builder.addInlineRule({
        name: 'empty-inline',
        priority: 'before:text',
        tokenize() {
          return { token: { type: 'text', raw: '', text: '' }, raw: '' }
        },
      })
    }

    expect(() => createParser({ plugins: [plugin] }).parse('input')).toThrow(
      'must consume a non-empty prefix'
    )
  })

  it('honors inline priorities relative to built-in rules', () => {
    const makePlugin = (priority: 'before:strong' | 'after:strong'): MarkdownPlugin => (builder) => {
      builder.addInlineRule({
        name: `marker-${priority}`,
        priority,
        triggerChars: [42],
        tokenize(src) {
          const match = /^\*\*([^*]+)\*\*/.exec(src)
          if (!match) return null
          return {
            token: { type: 'html', raw: match[0], text: `<mark>${match[1]}</mark>` },
            raw: match[0],
          }
        },
      })
    }

    const before = createParser({ allowHtml: true, plugins: [makePlugin('before:strong')] })
    const after = createParser({ allowHtml: true, plugins: [makePlugin('after:strong')] })

    expect(before.parse('**value**')).toContain('<mark>value</mark>')
    expect(after.parse('**value**')).toContain('<strong>value</strong>')
  })

  it('terminates on deterministic fuzz and delimiter-heavy inputs', () => {
    const parser = createParser({ gfm: true, maxNestingDepth: 20 })
    const alphabet = '#*_~`[]()<>|\\\n abcXYZ019😀'
    let state = 0x12345678

    const random = (): number => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0
      return state
    }

    for (let sample = 0; sample < 300; sample++) {
      const length = random() % 256
      let markdown = ''
      for (let index = 0; index < length; index++) {
        markdown += alphabet[random() % alphabet.length]
      }
      expect(parser.parse(markdown)).toBeTypeOf('string')
    }

    for (const markdown of [
      '*'.repeat(20_000),
      '['.repeat(20_000),
      '>'.repeat(20_000),
      '1-'.repeat(20_000),
    ]) {
      expect(parser.parse(markdown)).toBeTypeOf('string')
    }
  })

  it('rejects raw HTML tokens passed to render when HTML is disabled', () => {
    const parser = createParser({ allowHtml: false })
    const htmlBlock = {
      type: 'html' as const,
      raw: '<img src=x onerror=alert(1)>',
      text: '<img src=x onerror=alert(1)>',
    }
    const htmlInline = {
      type: 'html' as const,
      raw: '<b>unsafe</b>',
      text: '<b>unsafe</b>',
    }

    expect(() => parser.render([htmlBlock])).toThrow('Raw HTML tokens require allowHtml: true')

    expect(() => parser.render([{
      type: 'paragraph',
      raw: '**unsafe**',
      text: '**unsafe**',
      tokens: [{
        type: 'strong',
        raw: '**unsafe**',
        text: 'unsafe',
        tokens: [htmlInline],
      }],
    }])).toThrow('Raw HTML tokens require allowHtml: true')

    const nestedCases: BlockToken[][] = [
      [{ type: 'blockquote', raw: '> unsafe', tokens: [htmlBlock] }],
      [{
        type: 'list',
        raw: '- unsafe',
        ordered: false,
        items: [{ text: 'unsafe', tokens: [htmlBlock] }],
      }],
      [{
        type: 'table',
        raw: '| unsafe |',
        align: [null],
        header: [{ text: 'unsafe', tokens: [htmlInline] }],
        rows: [],
      }],
    ]
    for (const tokens of nestedCases) {
      expect(() => parser.render(tokens)).toThrow('Raw HTML tokens require allowHtml: true')
    }
  })

  it('checks raw HTML tokens added by token transforms', () => {
    const plugin: MarkdownPlugin = (builder) => {
      builder.addTokenTransform(() => [{
        type: 'html',
        raw: '<script>alert(1)</script>',
        text: '<script>alert(1)</script>',
      }])
    }
    const parser = createParser({ plugins: [plugin] })

    expect(() => parser.parse('safe')).toThrow('Raw HTML tokens require allowHtml: true')
  })

  it('rejects malformed, cyclic, and over-depth token graphs before rendering', () => {
    const parser = createParser({ ugc: true })
    const injectedStart = [{
      type: 'list',
      raw: '',
      ordered: true,
      start: '1" data-review-marker="yes',
      items: [],
    }] as unknown as BlockToken[]
    expect(() => parser.render(injectedStart)).toThrow('safe integer')

    const invalidHeading = [{
      type: 'heading',
      raw: '',
      text: '',
      level: '1 data-review-marker=yes',
      tokens: [],
    }] as unknown as BlockToken[]
    expect(() => parser.render(invalidHeading)).toThrow('Heading level')

    const invalidTable = [{
      type: 'table',
      raw: '',
      align: ['left" data-review-marker="yes'],
      header: [{ text: 'safe', tokens: [{ type: 'text', raw: 'safe', text: 'safe' }] }],
      rows: [],
    }] as unknown as BlockToken[]
    expect(() => parser.render(invalidTable)).toThrow('Table alignment')

    const cycle = { type: 'blockquote', raw: '', tokens: [] } as unknown as {
      type: 'blockquote'
      raw: string
      tokens: BlockToken[]
    }
    cycle.tokens.push(cycle as BlockToken)
    expect(() => parser.render([cycle as BlockToken])).toThrow('Cyclic token graph')

    let nested: BlockToken = {
      type: 'paragraph', raw: 'safe', text: 'safe', tokens: [{ type: 'text', raw: 'safe', text: 'safe' }],
    }
    for (let depth = 0; depth < 300; depth++) {
      nested = { type: 'blockquote', raw: '', tokens: [nested] }
    }
    expect(() => parser.render([nested])).toThrow('render depth')
  })

  it('enforces configured and UGC input limits', () => {
    expect(() => createParser({ maxInputLength: -1 })).toThrow(
      'maxInputLength must be a non-negative safe integer'
    )
    expect(() => createParser({ maxInputLength: 3 }).parse('four')).toThrow(
      'exceeds maxInputLength 3'
    )
    expect(() => createParser({ ugc: true, maxInputLength: 3 }).parse('four')).toThrow(
      'exceeds maxInputLength 3'
    )
    expect(() => createParser({ ugc: true, maxInputLength: 2_000_000 })
      .parse('x'.repeat(1_000_001))).toThrow('exceeds maxInputLength 1000000')
  })

  it('enforces a parser-wide UGC token budget', () => {
    const parser = createParser({ ugc: true })
    expect(() => parser.parse('# a\n'.repeat(50_001))).toThrow(
      'Markdown token count exceeds UGC limit 50000'
    )

    const paragraph: BlockToken = {
      type: 'paragraph',
      raw: 'a',
      text: 'a',
      tokens: [{ type: 'text', raw: 'a', text: 'a' }],
    }
    expect(() => parser.render(Array(50_001).fill(paragraph))).toThrow(
      'Markdown token count exceeds UGC limit 50000'
    )

    expect(() => parser.tokenize('<http:x>'.repeat(25_000))).toThrow(
      'Markdown token count exceeds UGC limit 50000'
    )
    expect(() => createParser({ ugc: true, gfm: true })
      .tokenize('www.a.co '.repeat(24_900))).toThrow(
      'Markdown token count exceeds UGC limit 50000'
    )
  })

  it('rejects over-budget shared token graphs before plugin transforms', () => {
    let transformEntered = false
    const plugin: MarkdownPlugin = (builder) => {
      builder.addTokenTransform((tokens) => {
        transformEntered = true
        return tokens
      })
    }
    const parser = createParser({ ugc: true, plugins: [plugin] })

    let node: BlockToken = {
      type: 'paragraph',
      raw: 'a',
      text: 'a',
      tokens: [{ type: 'text', raw: 'a', text: 'a' }],
    }
    for (let depth = 0; depth < 16; depth++) {
      node = { type: 'blockquote', raw: '>', tokens: [node, node] }
    }

    expect(() => parser.render([node])).toThrow(
      'Markdown token count exceeds UGC limit 50000'
    )
    expect(transformEntered).toBe(false)
  })

  it('parses unmatched link openers in linear time', { timeout: 1_000 }, () => {
    const parser = createParser()
    const markdown = '['.repeat(80_000)

    expect(parser.parse(markdown)).toContain('['.repeat(1_000))
    expect(parser.parse('[x]('.repeat(20_000))).toBeTypeOf('string')
    expect(parser.parse('[**bold**')).toBe('<p>[<strong>bold</strong></p>\n')
  })

  it('coalesces long invalid-special runs into bounded inline token counts', () => {
    const tokens = createParser({ ugc: true }).tokenize('!'.repeat(1_000_000))
    const paragraph = tokens[0]
    expect(paragraph?.type).toBe('paragraph')
    if (paragraph?.type === 'paragraph') expect(paragraph.tokens).toHaveLength(1)
  })

  it('stops direct links at the matching destination parenthesis', () => {
    const parser = createParser()

    expect(parser.parse('[x](url)tail)')).toBe('<p><a href="url">x</a>tail)</p>\n')
    expect(parser.parse('[x](url_(nested))')).toBe(
      '<p><a href="url_(nested)">x</a></p>\n'
    )
  })

  it('does not resolve reference labels longer than the CommonMark limit', () => {
    const parser = createParser()
    const label = 'a'.repeat(1_000)
    const html = parser.parse(`[${label}]\n\n[${label}]: https://example.com`)

    expect(html).not.toContain('<a href=')
  })
})
