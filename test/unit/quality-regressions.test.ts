import { describe, expect, it } from 'vitest'
import { createParser } from '../../src/index.js'
import { createParser as createSelectiveParser } from '../../src/core/parser.js'
import { heading, paragraph } from '../../src/blocks/index.js'
import type { MarkdownPlugin } from '../../src/core/types.js'

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
})
