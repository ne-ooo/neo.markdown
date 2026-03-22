---
name: getting-started
description: How to use @lpm.dev/neo.markdown — parse(), createParser(), plugin system (highlight, embeds, TOC, copy-code), PluginBuilder API, custom block/inline rules, renderer overrides, token transforms, CodeToken.meta, directive syntax, sub-path exports, sanitization, ugc, safeLinks, blocks
version: "1.2.1"
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
  gfm?: boolean               // Enable GFM tables, strikethrough, autolinks (default: false)
  breaks?: boolean             // Convert bare \n to <br> (default: false)
  sanitize?: boolean           // Sanitize HTML when allowHtml is true (default: false)
  allowedTags?: string[]       // Extend default allowed tags (requires sanitize: true)
  allowedAttributes?: Record<string, string[]>  // Per-tag allowed attributes
  allowStyle?: boolean         // Allow style attributes in sanitized HTML (default: false)
  safeLinks?: boolean | SafeLinkOptions  // External link rel/target, baseUrl resolution
  ugc?: boolean                // Shorthand for safe user-generated content rendering
  lazyImages?: boolean         // Add loading="lazy" to images (default: true)
  blocks?: BlockRule[]         // Selective block rules for tree-shaking
  plugins?: MarkdownPlugin[]   // Plugins to extend the parser
}
```

## Sanitization

When `allowHtml: true`, you can enable the built-in server-side sanitizer to strip dangerous HTML while keeping safe tags:

```typescript
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

To allow inline `style` attributes on sanitized elements, set `allowStyle: true`.

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

`ugc: true` is a one-line shorthand that enables safe defaults for untrusted content. It turns on `sanitize`, `safeLinks`, and disables `allowHtml`:

```typescript
const html = parse(commentBody, { ugc: true })
```

## Lazy Images

Images get `loading="lazy"` by default. Disable with `lazyImages: false`:

```typescript
const html = parse(md, { lazyImages: false })
```

## Selective Block Loading

Import individual block rules from `@lpm.dev/neo.markdown/blocks` and pass them via the `blocks` option. Unused rules are tree-shaken out of the bundle:

```typescript
import { createParser } from '@lpm.dev/neo.markdown'
import { heading, paragraph, code, list, blockquote } from '@lpm.dev/neo.markdown/blocks'

const parser = createParser({
  blocks: [heading, paragraph, code, list, blockquote],
})
```

Omitting `blocks` includes all block rules (default behavior).

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
import { embedPlugin } from '@lpm.dev/neo.markdown/plugins/embeds'

embedPlugin({
  youtube: { privacyEnhanced: true },
  vimeo: true,
  twitter: true,
  codesandbox: true,
  codepen: true,
  githubGist: true,
  loom: true,
  autoEmbed: true, // bare URLs in paragraphs become embeds
  consent: true,   // GDPR consent mode — shows placeholder until user opts in
})
```

Directive syntax in markdown:

```markdown
::youtube[dQw4w9WgXcQ]
::vimeo[361905857]
::tweet[2034382182353871105]
::codesandbox[abc123]
::codepen[user/pen/xyz]
::gist[username/gist_id]
::loom[share_id]
```

#### React Embed Components

Pre-built React components for embeds, using IntersectionObserver for lazy loading:

```tsx
import { YouTube, Vimeo, Tweet, CodeSandbox, CodePen, Gist, Loom } from '@lpm.dev/neo.markdown/plugins/embeds/react'

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

Injects a copy button into `<pre>` blocks. Includes an inline `<script>` for click-to-copy (no external JS needed) and default CSS styles with hover-to-reveal behavior:

```typescript
import { copyCodePlugin } from '@lpm.dev/neo.markdown/plugins/copy-code'

copyCodePlugin({
  buttonText: 'Copy',       // Text shown on the button (default: 'Copy')
  copiedText: 'Copied!',    // Text shown after copying (default: 'Copied!')
  buttonClass: 'copy-code-button',
  injectStyles: true,        // Inject default CSS for hover-to-reveal (default: true)
})
```

Set `injectStyles: false` if you provide your own CSS for the copy button. When `injectStyles` is true (default), the plugin injects a `<style>` block that hides the button until the user hovers over the code block.

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
