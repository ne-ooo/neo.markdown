import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createParser, parse } from '../../src/index.js'
import { createParser as selectiveParser } from '../../src/core/parser.js'
import { InlineTokenizer } from '../../src/core/inline-tokenizer.js'
import { list, paragraph } from '../../src/blocks/index.js'
import { decodeEntities } from '../../src/utils/markdown-text.js'
import type { InlineToken } from '../../src/core/types.js'

const inlineText = (tokens: InlineToken[]): string => tokens.map(token => 'tokens' in token
  ? inlineText(token.tokens) : token.type === 'br' ? '\n' : token.text).join('')

describe('Markdown compatibility and safety boundaries', () => {
  it('decodes all 2,125 named references from the independent WHATWG fixture', () => {
    const entities = JSON.parse(readFileSync(new URL('../fixtures/entities.json', import.meta.url), 'utf8')) as Record<string, string>
    expect(Object.keys(entities)).toHaveLength(2125)
    for (const [name, value] of Object.entries(entities)) expect(decodeEntities('&' + name), name).toBe(value)
  })
  it('decodes entities once without interpreting the decoded text as Markdown or HTML', () => {
    expect(parse('&lt;script&gt; &#42;bold&#42; &amp;copy; \\&copy;'))
      .toBe('<p>&lt;script&gt; *bold* &amp;copy; &amp;copy;</p>\n')
    expect(parse('`&copy;`\n\n```\n&copy;\n```'))
      .toBe('<p><code>&amp;copy;</code></p>\n<pre><code>&amp;copy;\n</code></pre>\n')
  })

  it('handles invalid Unicode references and unknown entity names', () => {
    expect(decodeEntities('&#0; &#xD800; &#1114112; &unknown; &#12345678;'))
      .toBe('� � � &unknown; &#12345678;')
    expect(decodeEntities('&NotEqualTilde; &CounterClockwiseContourIntegral;')).toBe('≂̸ ∳')
  })

  it.each(['javascript&colon;alert(1)', 'java&#9;script:alert(1)', 'javascript&#0;:alert(1)', 'javascript\0:alert(1)'])(
    'retains URL restrictions after decoding %s', destination => {
      const html = parse(`[link](${destination}) ![image](${destination})`)
      expect(html).not.toMatch(/href=|src=/)
      expect(html).toContain('link')
      expect(html).toContain('image')
    }
  )

  it('preserves code newlines and tabs and keeps raw fence metadata for plugins', () => {
    const parser = createParser()
    const [code] = parser.tokenize('  ```f&ouml;&ouml; raw\\* &copy;\r\n  a\tb\r\n\r\n  ```')
    expect(code).toMatchObject({ type: 'code', lang: 'föö', meta: 'raw\\* &copy;', text: 'a\tb\n\n' })
    expect(parser.tokenize('    a\tb\n')).toMatchObject([{ type: 'code', text: 'a\tb\n' }])
  })

  it('preserves Unicode spaces as paragraph content', () => {
    expect(parse('\u00a0')).toBe('<p>\u00a0</p>\n')
    expect(parse('x\u00a0')).toBe('<p>x\u00a0</p>\n')
    expect(parse('#\u00a0title')).toBe('<p>#\u00a0title</p>\n')
    expect(parse('- \u00a0')).toBe('<ul>\n<li>\u00a0</li>\n</ul>\n')
  })

  it('resets reference definitions between documents', () => {
    const parser = createParser()
    expect(parser.parse('[ref]\n\n[ref]: /first')).toContain('href="/first"')
    expect(parser.parse('[ref]')).toBe('<p>[ref]</p>\n')
  })

  it('terminates when the selected rules omit thematic breaks', () => {
    expect(() => selectiveParser({ blocks: [list, paragraph] }).parse('* * *')).not.toThrow()
  })

  it('bounds deeply nested emphasis without losing literal text', () => {
    const source = '*a '.repeat(200) + 'center' + ' z*'.repeat(200)
    const tokens = new InlineTokenizer().tokenize(source)
    const pending = tokens.map(token => ({ token, depth: 0 }))
    while (pending.length) {
      const { token, depth } = pending.pop()!
      expect(depth).toBeLessThanOrEqual(32)
      if ('tokens' in token) for (const child of token.tokens) pending.push({ token: child, depth: depth + 1 })
    }
    expect(inlineText(tokens).replace(/\*/g, '')).toBe(source.replace(/\*/g, ''))
  })

  it('lets custom inline rules precede emphasis', () => {
    const tokenizer = new InlineTokenizer([{
      name: 'custom-emphasis', priority: 'before:em', triggerChars: [42],
      tokenize(source) {
        const match = /^\*([^*]+)\*/.exec(source)
        return match ? { token: { type: 'code', raw: match[0], text: match[1] }, raw: match[0] } : null
      },
    }])
    expect(tokenizer.tokenize('*custom*')).toEqual([{ type: 'code', raw: '*custom*', text: 'custom' }])
  })
})
