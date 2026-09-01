import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.doUnmock('../../src/create-parser.js')
  vi.doUnmock('../../src/core/parser.js')
  vi.resetModules()
})

describe('optionless parser caches', () => {
  it('keeps one parser per convenience entry and isolates calls with options', async () => {
    const parserParse = vi.fn((markdown: string) => markdown)
    const createParser = vi.fn(() => ({ parse: parserParse }))
    const MarkdownParser = vi.fn(function MockMarkdownParser() {
      return { parse: parserParse }
    })
    vi.doMock('../../src/create-parser.js', () => ({ createParser }))
    vi.doMock('../../src/core/parser.js', () => ({
      MarkdownParser,
      MarkdownParserBase: MarkdownParser,
    }))

    const [main, commonmark, gfm] = await Promise.all([
      import('../../src/index.js'),
      import('../../src/presets/commonmark.js'),
      import('../../src/presets/gfm.js'),
    ])

    for (const entry of [main, commonmark, gfm]) {
      expect(entry.parse('first')).toBe('first')
      expect(entry.parse('second')).toBe('second')
      expect(entry.parse('configured', {})).toBe('configured')
    }

    expect(createParser).toHaveBeenCalledTimes(4)
    expect(MarkdownParser).toHaveBeenCalledTimes(2)
    expect(parserParse).toHaveBeenCalledTimes(9)
  })

  it('reuses the optionless sanitized parser', async () => {
    const parserParse = vi.fn((markdown: string) => markdown)
    const MarkdownParser = vi.fn(function MockMarkdownParser() {
      return { parse: parserParse }
    })
    vi.doMock('../../src/core/parser.js', () => ({ MarkdownParser }))

    const sanitized = await import('../../src/sanitized.js')

    expect(sanitized.parse('first')).toBe('first')
    expect(sanitized.parse('second')).toBe('second')
    expect(sanitized.parse('configured', {})).toBe('configured')
    expect(MarkdownParser).toHaveBeenCalledTimes(2)
    expect(parserParse).toHaveBeenCalledTimes(3)
  })
})
