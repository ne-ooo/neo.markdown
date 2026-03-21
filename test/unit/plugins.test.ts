/**
 * Plugin system tests
 *
 * Tests the full plugin infrastructure:
 * - Plugin registration and builder API
 * - Custom block rules
 * - Custom inline rules
 * - Renderer overrides
 * - Token transforms
 * - HTML transforms
 * - Plugin composition
 * - Backward compatibility (no plugins = unchanged behavior)
 */

import { describe, it, expect } from 'vitest'
import { parse, createParser } from '../../src/index.js'
import type {
  MarkdownPlugin,
  BlockToken,
  InlineToken,
  HeadingToken,
  CodeToken,
  ParserOptions,
} from '../../src/core/types.js'

// ---------------------------------------------------------------------------
// Backward Compatibility
// ---------------------------------------------------------------------------

describe('Plugin System - Backward Compatibility', () => {
  it('should produce identical output with no plugins', () => {
    const md = '# Hello\n\nWorld **bold** and *italic*'
    const withoutPlugins = parse(md)
    const withEmptyPlugins = parse(md, { plugins: [] })
    expect(withoutPlugins).toBe(withEmptyPlugins)
  })

  it('should produce identical output with undefined plugins', () => {
    const md = '# Hello\n\nWorld'
    const a = parse(md)
    const b = parse(md, { plugins: undefined })
    expect(a).toBe(b)
  })

  it('should handle all block types unchanged with no plugins', () => {
    const md = [
      '# Heading',
      '',
      'Paragraph',
      '',
      '```js',
      'code()',
      '```',
      '',
      '> Blockquote',
      '',
      '- List item',
      '',
      '---',
    ].join('\n')

    const result = parse(md)
    expect(result).toContain('<h1>')
    expect(result).toContain('<p>')
    expect(result).toContain('<pre><code')
    expect(result).toContain('<blockquote>')
    expect(result).toContain('<ul>')
    expect(result).toContain('<hr>')
  })
})

// ---------------------------------------------------------------------------
// Renderer Overrides (setRenderer)
// ---------------------------------------------------------------------------

describe('Plugin System - setRenderer', () => {
  it('should override the code renderer', () => {
    const plugin: MarkdownPlugin = (builder) => {
      builder.setRenderer('code', (token: CodeToken) => {
        return `<custom-code lang="${token.lang ?? ''}">${token.text}</custom-code>\n`
      })
    }

    const result = parse('```js\nfoo()\n```', { plugins: [plugin] })
    expect(result).toBe('<custom-code lang="js">foo()</custom-code>\n')
  })

  it('should override the heading renderer', () => {
    const plugin: MarkdownPlugin = (builder) => {
      builder.setRenderer('heading', (token: HeadingToken) => {
        const text = builder.renderInline(token.tokens)
        return `<h${token.level} class="custom">${text}</h${token.level}>\n`
      })
    }

    const result = parse('# Hello', { plugins: [plugin] })
    expect(result).toBe('<h1 class="custom">Hello</h1>\n')
  })

  it('should allow renderInline in renderer overrides', () => {
    const plugin: MarkdownPlugin = (builder) => {
      builder.setRenderer('heading', (token: HeadingToken) => {
        const text = builder.renderInline(token.tokens)
        const slug = text.toLowerCase().replace(/\s+/g, '-')
        return `<h${token.level} id="${slug}">${text}</h${token.level}>\n`
      })
    }

    const result = parse('## Hello World', { plugins: [plugin] })
    expect(result).toBe('<h2 id="hello-world">Hello World</h2>\n')
  })

  it('should keep non-overridden renderers unchanged', () => {
    const plugin: MarkdownPlugin = (builder) => {
      builder.setRenderer('code', (token: CodeToken) => {
        return `<custom>${token.text}</custom>\n`
      })
    }

    const result = parse('# Heading\n\n```\ncode\n```', { plugins: [plugin] })
    expect(result).toContain('<h1>Heading</h1>')
    expect(result).toContain('<custom>code</custom>')
  })

  it('should let last plugin win on conflicting overrides', () => {
    const plugin1: MarkdownPlugin = (builder) => {
      builder.setRenderer('code', () => '<first>\n')
    }
    const plugin2: MarkdownPlugin = (builder) => {
      builder.setRenderer('code', () => '<second>\n')
    }

    const result = parse('```\ntest\n```', { plugins: [plugin1, plugin2] })
    expect(result).toBe('<second>\n')
  })
})

// ---------------------------------------------------------------------------
// Token Transforms (addTokenTransform)
// ---------------------------------------------------------------------------

describe('Plugin System - addTokenTransform', () => {
  it('should transform tokens before rendering', () => {
    const plugin: MarkdownPlugin = (builder) => {
      builder.addTokenTransform((tokens) =>
        tokens.map((t) => {
          if (t.type === 'heading') {
            return { ...t, level: Math.min(t.level + 1, 6) as 1 | 2 | 3 | 4 | 5 | 6 }
          }
          return t
        })
      )
    }

    const result = parse('# H1\n\n## H2', { plugins: [plugin] })
    expect(result).toContain('<h2>H1</h2>')
    expect(result).toContain('<h3>H2</h3>')
  })

  it('should chain multiple token transforms in order', () => {
    const order: string[] = []

    const first: MarkdownPlugin = (builder) => {
      builder.addTokenTransform((tokens) => {
        order.push('first')
        return tokens.map((t) => {
          if (t.type === 'heading') {
            return { ...t, level: 2 as const }
          }
          return t
        })
      })
    }

    const second: MarkdownPlugin = (builder) => {
      builder.addTokenTransform((tokens) => {
        order.push('second')
        return tokens.map((t) => {
          if (t.type === 'heading') {
            return { ...t, level: 3 as const }
          }
          return t
        })
      })
    }

    // Transforms chain: h1 → h2 (first) → h3 (second)
    const result = parse('# Hello', { plugins: [first, second] })
    expect(result).toContain('<h3>')
    expect(order).toEqual(['first', 'second'])
  })

  it('should allow filtering out tokens', () => {
    const removeHr: MarkdownPlugin = (builder) => {
      builder.addTokenTransform((tokens) =>
        tokens.filter((t) => t.type !== 'hr')
      )
    }

    const result = parse('# Heading\n\n---\n\nParagraph', { plugins: [removeHr] })
    expect(result).toContain('<h1>')
    expect(result).toContain('<p>')
    expect(result).not.toContain('<hr>')
  })
})

// ---------------------------------------------------------------------------
// HTML Transforms (addHtmlTransform)
// ---------------------------------------------------------------------------

describe('Plugin System - addHtmlTransform', () => {
  it('should transform HTML after rendering', () => {
    const plugin: MarkdownPlugin = (builder) => {
      builder.addHtmlTransform((html) =>
        html.replace(/<pre>/g, '<pre class="highlight">')
      )
    }

    const result = parse('```\ncode\n```', { plugins: [plugin] })
    expect(result).toContain('<pre class="highlight">')
  })

  it('should chain multiple HTML transforms', () => {
    const wrap: MarkdownPlugin = (builder) => {
      builder.addHtmlTransform((html) => `<div class="content">${html}</div>`)
    }
    const addClass: MarkdownPlugin = (builder) => {
      builder.addHtmlTransform((html) => html.replace(/<h1>/g, '<h1 class="title">'))
    }

    const result = parse('# Title', { plugins: [wrap, addClass] })
    expect(result).toContain('<div class="content">')
    expect(result).toContain('<h1 class="title">')
  })
})

// ---------------------------------------------------------------------------
// Custom Block Rules (addBlockRule)
// ---------------------------------------------------------------------------

describe('Plugin System - addBlockRule', () => {
  it('should add a custom block rule', () => {
    const notePlugin: MarkdownPlugin = (builder) => {
      builder.addBlockRule({
        name: 'note',
        priority: 800, // Same as heading
        tokenize(src) {
          const match = /^:::note\n([\s\S]*?)\n:::(?:\n|$)/.exec(src)
          if (!match) return null
          return {
            token: {
              type: 'html',
              raw: match[0],
              text: `<div class="note">${match[1]}</div>`,
            },
            raw: match[0],
          }
        },
      })
    }

    const result = parse(':::note\nImportant info\n:::', { plugins: [notePlugin] })
    expect(result).toContain('<div class="note">Important info</div>')
  })

  it('should respect before: positional constraint', () => {
    const results: string[] = []

    const plugin: MarkdownPlugin = (builder) => {
      builder.addBlockRule({
        name: 'tracer',
        priority: 'before:paragraph',
        tokenize(src) {
          if (src.startsWith('TRACE:')) {
            const line = src.split('\n')[0]
            results.push(line)
            return {
              token: {
                type: 'html',
                raw: line + '\n',
                text: `<trace>${line.slice(6)}</trace>`,
              },
              raw: line + '\n',
            }
          }
          return null
        },
      })
    }

    const result = parse('TRACE:hello\n\nNormal paragraph', { plugins: [plugin] })
    expect(result).toContain('<trace>hello</trace>')
    expect(result).toContain('<p>Normal paragraph</p>')
  })

  it('should produce directive tokens', () => {
    const directivePlugin: MarkdownPlugin = (builder) => {
      builder.addBlockRule({
        name: 'directive',
        priority: 'before:paragraph',
        tokenize(src) {
          const match = /^::(\w+)\[([^\]]*)\](?:\{([^}]*)\})?(?:\n|$)/.exec(src)
          if (!match) return null
          const attrs: Record<string, string> = {}
          if (match[3]) {
            for (const pair of match[3].split(/\s+/)) {
              const [k, v] = pair.split('=')
              if (k && v) attrs[k] = v.replace(/^"|"$/g, '')
            }
          }
          return {
            token: {
              type: 'directive',
              raw: match[0],
              name: match[1],
              label: match[2] || undefined,
              attributes: attrs,
            },
            raw: match[0],
          }
        },
      })

      builder.setRenderer('directive', (token) => {
        if (token.name === 'youtube') {
          return `<iframe src="https://www.youtube.com/embed/${token.label}"></iframe>\n`
        }
        return ''
      })
    }

    const result = parse('::youtube[dQw4w9WgXcQ]', { plugins: [directivePlugin] })
    expect(result).toContain('<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe>')
  })
})

// ---------------------------------------------------------------------------
// Custom Inline Rules (addInlineRule)
// ---------------------------------------------------------------------------

describe('Plugin System - addInlineRule', () => {
  it('should add a custom inline rule with trigger chars', () => {
    const highlightPlugin: MarkdownPlugin = (builder) => {
      builder.addInlineRule({
        name: 'highlight',
        triggerChars: [61], // '='
        tokenize(src) {
          const match = /^==(.*?)==/.exec(src)
          if (!match) return null
          return {
            token: {
              type: 'html',
              raw: match[0],
              text: `<mark>${match[1]}</mark>`,
            },
            raw: match[0],
          }
        },
      })
    }

    const result = parse('This is ==highlighted== text', {
      allowHtml: true,
      plugins: [highlightPlugin],
    })
    expect(result).toContain('<mark>highlighted</mark>')
  })

  it('should add a custom inline rule without trigger chars', () => {
    const emojiPlugin: MarkdownPlugin = (builder) => {
      builder.addInlineRule({
        name: 'emoji',
        tokenize(src) {
          const match = /^:(\w+):/.exec(src)
          if (!match) return null
          const emojis: Record<string, string> = { smile: '😊', heart: '❤️' }
          const emoji = emojis[match[1]]
          if (!emoji) return null
          return {
            token: { type: 'text', raw: match[0], text: emoji },
            raw: match[0],
          }
        },
      })
    }

    const result = parse('Hello :smile: world', { plugins: [emojiPlugin] })
    expect(result).toContain('😊')
  })
})

// ---------------------------------------------------------------------------
// CodeToken.meta Enhancement
// ---------------------------------------------------------------------------

describe('Plugin System - CodeToken.meta', () => {
  it('should parse meta from fenced code blocks', () => {
    const parser = createParser()
    const tokens = parser.tokenize('```typescript {1,3-5} title="example.ts"\nconst x = 1\n```')
    const code = tokens[0] as CodeToken
    expect(code.type).toBe('code')
    expect(code.lang).toBe('typescript')
    expect(code.meta).toBe('{1,3-5} title="example.ts"')
  })

  it('should have undefined meta when no meta string', () => {
    const parser = createParser()
    const tokens = parser.tokenize('```js\ncode()\n```')
    const code = tokens[0] as CodeToken
    expect(code.lang).toBe('js')
    expect(code.meta).toBeUndefined()
  })

  it('should handle lang without meta', () => {
    const parser = createParser()
    const tokens = parser.tokenize('```python\nprint("hi")\n```')
    const code = tokens[0] as CodeToken
    expect(code.lang).toBe('python')
    expect(code.meta).toBeUndefined()
  })

  it('should use meta in a highlight plugin', () => {
    const highlight: MarkdownPlugin = (builder) => {
      builder.setRenderer('code', (token: CodeToken) => {
        const highlightLines = token.meta ?? ''
        return `<pre data-highlight="${highlightLines}"><code>${token.text}</code></pre>\n`
      })
    }

    const result = parse('```ts {1,3}\nconst a = 1\nconst b = 2\nconst c = 3\n```', {
      plugins: [highlight],
    })
    expect(result).toContain('data-highlight="{1,3}"')
  })
})

// ---------------------------------------------------------------------------
// Plugin Composition
// ---------------------------------------------------------------------------

describe('Plugin System - Composition', () => {
  it('should compose multiple plugins', () => {
    const addCodeClass: MarkdownPlugin = (builder) => {
      builder.setRenderer('code', (token: CodeToken) => {
        return `<pre class="hljs"><code>${token.text}</code></pre>\n`
      })
    }

    const addHeadingId: MarkdownPlugin = (builder) => {
      builder.setRenderer('heading', (token: HeadingToken) => {
        const text = builder.renderInline(token.tokens)
        const id = text.toLowerCase().replace(/\s+/g, '-')
        return `<h${token.level} id="${id}">${text}</h${token.level}>\n`
      })
    }

    const addWrapper: MarkdownPlugin = (builder) => {
      builder.addHtmlTransform((html) => `<article>${html}</article>`)
    }

    const result = parse('# Title\n\n```\ncode\n```', {
      plugins: [addCodeClass, addHeadingId, addWrapper],
    })

    expect(result).toContain('<article>')
    expect(result).toContain('<h1 id="title">Title</h1>')
    expect(result).toContain('<pre class="hljs">')
    expect(result).toContain('</article>')
  })

  it('should pass readonly options to plugins', () => {
    let receivedOptions: Readonly<ParserOptions> | null = null

    const plugin: MarkdownPlugin = (builder) => {
      receivedOptions = builder.options
    }

    parse('test', { gfm: true, plugins: [plugin] })
    expect(receivedOptions).not.toBeNull()
    expect(receivedOptions!.gfm).toBe(true)
  })

  it('should run token transforms after tokenization but before rendering', () => {
    const order: string[] = []

    const plugin: MarkdownPlugin = (builder) => {
      builder.addTokenTransform((tokens) => {
        order.push('tokenTransform')
        return tokens
      })
      builder.addHtmlTransform((html) => {
        order.push('htmlTransform')
        return html
      })
    }

    parse('# Test', { plugins: [plugin] })
    expect(order).toEqual(['tokenTransform', 'htmlTransform'])
  })

  it('should work with no-op plugin', () => {
    const noopPlugin: MarkdownPlugin = (_builder) => {
      // does nothing
    }

    const result = parse('# Hello', { plugins: [noopPlugin] })
    expect(result).toBe('<h1>Hello</h1>\n')
  })
})

// ---------------------------------------------------------------------------
// Builder API
// ---------------------------------------------------------------------------

describe('Plugin System - Builder API', () => {
  it('should expose renderInline on the builder', () => {
    let rendered = ''

    const plugin: MarkdownPlugin = (builder) => {
      builder.addTokenTransform((tokens) => {
        for (const t of tokens) {
          if (t.type === 'paragraph') {
            rendered = builder.renderInline(t.tokens)
          }
        }
        return tokens
      })
    }

    parse('Hello **world**', { plugins: [plugin] })
    expect(rendered).toBe('Hello <strong>world</strong>')
  })

  it('should expose renderBlock on the builder', () => {
    let rendered = ''

    const plugin: MarkdownPlugin = (builder) => {
      builder.addTokenTransform((tokens) => {
        rendered = builder.renderBlock(tokens)
        return tokens
      })
    }

    parse('# Hello', { plugins: [plugin] })
    expect(rendered).toContain('<h1>Hello</h1>')
  })
})
