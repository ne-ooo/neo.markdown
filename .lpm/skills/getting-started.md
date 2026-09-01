---
name: getting-started
description: How to use @lpm.dev/neo.markdown — parse(), createParser(), plugin system (highlight, embeds, TOC, copy-code), PluginBuilder API, custom block/inline rules, renderer overrides, token transforms, CodeToken.meta, directive syntax, sub-path exports, sanitization, ugc, safeLinks, blocks
version: "2.0.0"
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

An optionless `parse()` call reuses one lazy parser. If you pass options, `parse()` creates a new parser. For repeated parsing with the same options, use `createParser()`:

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
  gfm?: boolean               // Enable GFM tables, strikethrough, autolinks (default: false)
  breaks?: boolean             // Convert bare \n to <br> (default: false)
  sanitize?: boolean           // Sanitize HTML when allowHtml is true (default: false)
  sanitizer?: HtmlSanitizer    // Custom sanitizer provider
  allowedTags?: string[]       // Extend default allowed tags (requires sanitize: true)
  allowedAttributes?: Record<string, string[]>  // Per-tag allowed attributes
  allowStyle?: boolean         // Allow restricted style properties in sanitized HTML (default: false)
  safeLinks?: boolean | SafeLinkOptions  // External link rel/target, baseUrl resolution
  ugc?: boolean                // Shorthand for safe user-generated content rendering
  maxInputLength?: number      // Maximum input length in UTF-16 code units
  lazyImages?: boolean         // Add loading="lazy" to images (default: true)
  blocks?: BlockRule[]         // Selective block rules for tree-shaking
  plugins?: MarkdownPlugin[]   // Plugins to extend the parser
}
```

## Sanitization

Import the `/sanitized` entry to use the built-in structural sanitizer:

```typescript
import { parse } from '@lpm.dev/neo.markdown/sanitized'

const html = parse(userInput, {
  allowHtml: true,
  sanitize: true,
})
```

`allowedTags` extends the defaults (it does not replace them). `allowedAttributes` is a per-tag record:

```typescript
const html = parse(userInput, {
  allowHtml: true,
  sanitize: true,
  allowedTags: ['details', 'summary'],
  allowedAttributes: { a: ['href', 'title'], img: ['src', 'alt'] },
})
```

Set `allowStyle: true` to permit these properties:

- `color`
- `background-color`
- `font-style`
- `font-weight`
- `text-align`
- `text-decoration`
- `white-space`

The sanitizer removes layout properties, CSS expressions, and URL values.

## Safe Links

`safeLinks` adds `rel="noopener noreferrer"` and `target="_blank"` to external links, and resolves relative URLs against a `baseUrl`:

```typescript
const html = parse(readme, { safeLinks: true })

// With baseUrl for relative link resolution
const html = parse(readme, {
  safeLinks: { baseUrl: 'https://github.com/org/repo/blob/main/' },
})
```

## User-Generated Content (UGC)

`ugc: true` enables safe defaults for untrusted content. It enables `safeLinks`, disables raw HTML, and limits the input size:

```typescript
const html = parse(commentBody, { ugc: true })
```

UGC mode limits input to 1,000,000 UTF-16 code units. Use `maxInputLength` to set a smaller limit.

## Lazy Images

Images get `loading="lazy"` by default. Disable with `lazyImages: false`:

```typescript
const html = parse(md, { lazyImages: false })
```

## Selective Block Loading

Import individual block rules from `@lpm.dev/neo.markdown/blocks` and pass them via the `blocks` option. Unused rules are tree-shaken out of the bundle:

```typescript
import { createParser } from '@lpm.dev/neo.markdown/core'
import { heading, paragraph, code, list, blockquote } from '@lpm.dev/neo.markdown/blocks'

const parser = createParser({
  blocks: [heading, paragraph, code, list, blockquote],
})
```

The `/core` factory requires an explicit `blocks` array. Import from the main package when you want all default rules. Passing `blocks` to the main factory changes behavior but does not reduce the main entry bundle.

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

YouTube, Vimeo, Twitter/X, CodeSandbox, CodePen, GitHub Gist, and Loom embeds via directive syntax:

```typescript
import {
  embedPlugin,
  initializeEmbeds,
} from '@lpm.dev/neo.markdown/plugins/embeds'

embedPlugin({
  youtube: { privacyEnhanced: true },
  vimeo: true,
  twitter: true,
  codesandbox: true,
  codepen: true,
  gist: true,
  loom: true,
  autoEmbed: true, // bare URLs in paragraphs become embeds
  consent: true,   // GDPR consent mode — shows placeholder until user opts in
})

// After the rendered HTML mounts, run this.
const cleanup = initializeEmbeds()
```

The initializer handles consent clicks, Gist frames, and Twitter widgets. When the rendered root unmounts, run `cleanup()`.

Directive syntax in markdown:

```markdown
::youtube[dQw4w9WgXcQ]
::vimeo[361905857]
::tweet[2034382182353871105]
::codesandbox[abc123]
::codepen[xyz]{user="username"}
::gist[abc123def]{user="username"}
::loom[share_id]
```

#### React Embed Components

Pre-built React components for embeds. Vimeo and Tweet defer content with IntersectionObserver. The iframe-based components use native `loading="lazy"`. GitHub Gist embeds use the HTML plugin and `initializeEmbeds()` above:

```tsx
import { YouTube, Vimeo, Tweet, CodeSandbox, CodePen, Loom } from '@lpm.dev/neo.markdown/plugins/embeds/react'

<YouTube id="dQw4w9WgXcQ" privacyEnhanced />
<Vimeo id="361905857" />
<Tweet id="2034382182353871105" />
<CodeSandbox id="abc123" />
<Loom id="share_id" />
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

Injects an inert copy button into `<pre>` blocks. It does not emit inline scripts. Call the explicit initializer once from client code:

```typescript
import {
  copyCodePlugin,
  getCopyCodeStyles,
  initializeCopyCode,
} from '@lpm.dev/neo.markdown/plugins/copy-code'

copyCodePlugin({
  buttonText: 'Copy',       // Text shown on the button (default: 'Copy')
  copiedText: 'Copied!',    // Text shown after copying (default: 'Copied!')
  buttonClass: 'copy-code-button',
  injectStyles: true,        // Inject default CSS for hover-to-reveal (default: true)
})

const cleanup = initializeCopyCode()
```

Set `injectStyles: false` for a strict style CSP. Use `getCopyCodeStyles()` to write the default CSS to an external stylesheet. Class names are validated as single CSS identifiers, and all labels are HTML-escaped.

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
    starts: (src) => src.startsWith(':::note\n'),
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

Use `starts()` when the rule can interrupt a paragraph. A successful block or inline rule must consume a non-empty source prefix in `raw`; the parser rejects invalid rule results.

### Custom Inline Rule

```typescript
const highlightPlugin: MarkdownPlugin = (builder) => {
  builder.addInlineRule({
    name: 'highlight',
    priority: 'before:em',
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
| `@lpm.dev/neo.markdown/blocks` | Block token types, `Tokenizer` class, individual block rules (`heading`, `paragraph`, `code`, etc.) |
| `@lpm.dev/neo.markdown/inline` | Inline token types and `InlineTokenizer` class |
| `@lpm.dev/neo.markdown/commonmark` | CommonMark preset |
| `@lpm.dev/neo.markdown/gfm` | GFM preset |
| `@lpm.dev/neo.markdown/plugins/highlight` | Syntax highlighting plugin |
| `@lpm.dev/neo.markdown/plugins/embeds` | Embed plugin (YouTube, Vimeo, Twitter, CodeSandbox, CodePen, Gist, Loom) |
| `@lpm.dev/neo.markdown/plugins/embeds/react` | React embed components (`<YouTube>`, `<Vimeo>`, `<Tweet>`, etc.) |
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
