---
name: getting-started
description: How to use @lpm.dev/neo.markdown — parse(), createParser(), plugin system (highlight, embeds, TOC, copy-code), PluginBuilder API, custom block/inline rules, renderer overrides, token transforms, CodeToken.meta, directive syntax, sub-path exports
version: "1.1.0"
globs:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.js"
  - "**/*.jsx"
---

# Getting Started with @lpm.dev/neo.markdown

## Quick Start

Convert markdown to HTML:

```typescript
import { parse } from '@lpm.dev/neo.markdown'

const html = parse('# Hello World\n\nThis is **bold** and *italic*.')
```

`parse()` creates a new parser on every call. For repeated parsing, use `createParser()`:

```typescript
import { createParser } from '@lpm.dev/neo.markdown'

const parser = createParser()
const html1 = parser.parse(doc1)
const html2 = parser.parse(doc2)
```

## Options

```typescript
interface ParserOptions {
  allowHtml?: boolean         // Allow raw HTML in output (default: false)
  gfm?: boolean               // Enable GFM features (default: false)
  breaks?: boolean             // Convert \n to <br> (default: false)
  plugins?: MarkdownPlugin[]   // Plugins to extend the parser
}
```

GFM features (tables, strikethrough, task lists, autolinks) are available via the tokenizer regardless of the `gfm` flag — the flag controls preset behavior.

## Plugin System

Plugins extend the parser with custom tokenization, rendering, and transforms. A plugin is a plain function:

```typescript
import { createParser } from '@lpm.dev/neo.markdown'
import { tocPlugin } from '@lpm.dev/neo.markdown/plugins/toc'
import { embedPlugin } from '@lpm.dev/neo.markdown/plugins/embeds'
import { copyCodePlugin } from '@lpm.dev/neo.markdown/plugins/copy-code'

const parser = createParser({
  gfm: true,
  plugins: [
    tocPlugin({ maxDepth: 3 }),
    embedPlugin({ youtube: true, twitter: true }),
    copyCodePlugin(),
  ]
})
```

### Highlight Plugin

Syntax highlighting via `@lpm.dev/neo.highlight`. Pass the functions directly:

```typescript
import { highlightPlugin } from '@lpm.dev/neo.markdown/plugins/highlight'
import { tokenize, renderToHTML, getThemeStylesheet } from '@lpm.dev/neo.highlight'
import { javascript, typescript, python } from '@lpm.dev/neo.highlight/grammars'
import { githubDark } from '@lpm.dev/neo.highlight/themes/github-dark'

highlightPlugin({
  grammars: [javascript, typescript, python],
  tokenize,
  renderToHTML,
  getThemeStylesheet, // generates CSS mapping .neo-hl-keyword → var(--neo-hl-keyword)
  theme: githubDark,
  lineNumbers: true,
})
```

In React, generate the theme CSS separately and include it as a `<style>` element (not inside `dangerouslySetInnerHTML`):

```tsx
const themeCSS = getThemeStylesheet(githubDark)
// Render as: <style>{themeCSS}</style>
```

Code block meta strings are parsed: `` ```ts {1,3-5} `` → `lang: "ts"`, `meta: "{1,3-5}"`.

### Embed Plugin

YouTube, Vimeo, Twitter/X embeds via directive syntax:

```typescript
import { embedPlugin } from '@lpm.dev/neo.markdown/plugins/embeds'

embedPlugin({
  youtube: { privacyEnhanced: true },
  vimeo: true,
  twitter: true,
  autoEmbed: true, // bare URLs in paragraphs become embeds
})
```

Directive syntax in markdown:

```markdown
::youtube[dQw4w9WgXcQ]
::vimeo[361905857]
::tweet[2034382182353871105]
```

### TOC Plugin

Heading anchors + table of contents extraction:

```typescript
import { tocPlugin } from '@lpm.dev/neo.markdown/plugins/toc'
import type { TocEntry } from '@lpm.dev/neo.markdown/plugins/toc'

let toc: TocEntry[] = []

tocPlugin({
  maxDepth: 3,
  minDepth: 1,
  anchorLinks: true,
  anchorClass: 'anchor',
  onToc: (entries) => { toc = entries },
})
// toc = [{ level: 1, text: 'Title', id: 'title' }, ...]
```

Produces: `<h1 id="title"><a class="anchor" href="#title">Title</a></h1>`

### Copy-Code Plugin

Injects a copy button into `<pre>` blocks:

```typescript
import { copyCodePlugin } from '@lpm.dev/neo.markdown/plugins/copy-code'

copyCodePlugin({ buttonText: 'Copy', buttonClass: 'copy-code-button' })
```

## Writing Custom Plugins

### PluginBuilder API

| Method | Description |
|--------|-------------|
| `addBlockRule(rule)` | Custom block-level tokenization rule |
| `addInlineRule(rule)` | Custom inline tokenization rule |
| `setRenderer(method, fn)` | Override a renderer method (e.g. `'code'`, `'heading'`) |
| `addTokenTransform(fn)` | Transform tokens after tokenization, before rendering |
| `addHtmlTransform(fn)` | Transform the final HTML string |
| `renderInline(tokens)` | Utility: render inline tokens to HTML |
| `renderBlock(tokens)` | Utility: render block tokens to HTML |
| `options` | Read-only access to parser options |

### Custom Block Rule

```typescript
const notePlugin: MarkdownPlugin = (builder) => {
  builder.addBlockRule({
    name: 'note',
    priority: 'before:paragraph', // or numeric: 800
    tokenize(src, options) {
      const match = /^:::note\n([\s\S]*?)\n:::(?:\n|$)/.exec(src)
      if (!match) return null
      return {
        token: { type: 'html', raw: match[0], text: `<div class="note">${match[1]}</div>` },
        raw: match[0],
      }
    },
  })
}
```

### Custom Inline Rule

```typescript
const highlightPlugin: MarkdownPlugin = (builder) => {
  builder.addInlineRule({
    name: 'highlight',
    triggerChars: [61], // '=' char code — preserves fast-path optimization
    tokenize(src) {
      const match = /^==(.*?)==/.exec(src)
      if (!match) return null
      return {
        token: { type: 'html', raw: match[0], text: `<mark>${match[1]}</mark>` },
        raw: match[0],
      }
    },
  })
}
```

### Renderer Override

```typescript
const plugin: MarkdownPlugin = (builder) => {
  builder.setRenderer('heading', (token) => {
    const text = builder.renderInline(token.tokens) // utility for rendering
    return `<h${token.level} class="custom">${text}</h${token.level}>\n`
  })
}
```

### Token Transform

```typescript
const removeHr: MarkdownPlugin = (builder) => {
  builder.addTokenTransform((tokens) => tokens.filter((t) => t.type !== 'hr'))
}
```

### HTML Transform

```typescript
const wrapper: MarkdownPlugin = (builder) => {
  builder.addHtmlTransform((html) => `<article>${html}</article>`)
}
```

## Sub-path Exports

| Import Path | What You Get |
|-------------|-------------|
| `@lpm.dev/neo.markdown` | `parse`, `createParser`, `HtmlRenderer`, all types |
| `@lpm.dev/neo.markdown/core` | Core parser, tokenizers, renderer, PluginBuilderImpl, types |
| `@lpm.dev/neo.markdown/blocks` | Block token types and `Tokenizer` class |
| `@lpm.dev/neo.markdown/inline` | Inline token types and `InlineTokenizer` class |
| `@lpm.dev/neo.markdown/commonmark` | CommonMark preset |
| `@lpm.dev/neo.markdown/gfm` | GFM preset |
| `@lpm.dev/neo.markdown/plugins/highlight` | Syntax highlighting plugin |
| `@lpm.dev/neo.markdown/plugins/embeds` | Embed plugin (YouTube, Vimeo, Twitter) |
| `@lpm.dev/neo.markdown/plugins/toc` | TOC plugin (heading anchors) |
| `@lpm.dev/neo.markdown/plugins/copy-code` | Copy-code button plugin |

## Working with Tokens

Access the AST for custom processing:

```typescript
import { createParser } from '@lpm.dev/neo.markdown'
import type { BlockToken, HeadingToken, CodeToken } from '@lpm.dev/neo.markdown'

const parser = createParser()
const tokens: BlockToken[] = parser.tokenize('# Hello\n\n```ts {1}\ncode\n```')

// HeadingToken: { type: 'heading', level: 1, text: 'Hello', tokens: [...] }
// CodeToken: { type: 'code', lang: 'ts', meta: '{1}', text: 'code' }

const html = parser.render(tokens)
```

Note: `parser.tokenize()` returns tokens BEFORE plugin token transforms run. Token transforms only run inside `parser.parse()`.
