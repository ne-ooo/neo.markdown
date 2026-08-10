# @lpm.dev/neo.markdown

Modern, tree-shakeable Markdown-subset parser. TypeScript-first, XSS-safe by default, and extensible through a simple plugin system.

## Install

```bash
lpm install @lpm.dev/neo.markdown
```

## Quick Start

```typescript
import { parse } from '@lpm.dev/neo.markdown'

const html = parse('# Hello\n\nWorld')
// '<h1>Hello</h1>\n<p>World</p>\n'
```

## Features

- **Markdown subset** — continuously measured against CommonMark 0.31.2 fixtures
- **GFM** (GitHub Flavored Markdown) — tables, task lists, strikethrough
- **XSS protection** — HTML escaped by default
- **Plugin system** — highlight, embeds, TOC, copy-code, or write your own
- **Tree-shakeable** — sub-path imports for each layer
- **Optional structural HTML sanitization** through the `/sanitized` entry
- **TypeScript** — full type declarations

## API

### `parse(markdown, options?)`

Optionless calls reuse one lazy parser for lower setup cost. A call that passes options uses a new parser. Use `createParser(options)` when you parse many documents with the same options.

```typescript
import { parse } from '@lpm.dev/neo.markdown'

// Basic
parse('# Hello')
// => '<h1>Hello</h1>\n'

// XSS-safe by default
parse('<script>alert("xss")</script>')
// => '<p>&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;</p>\n'

// Allow trusted HTML
parse('<div class="box">content</div>', { allowHtml: true })
// => '<div class="box">content</div>\n'
```

### `createParser(options?)`

```typescript
import { createParser } from '@lpm.dev/neo.markdown'

const parser = createParser({ allowHtml: false })

parser.parse('# Hello')
parser.parse('**bold** text')
```

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `allowHtml` | `boolean` | `false` | Allow raw HTML in output |
| `sanitize` | `boolean` | `false` | Sanitize HTML (strip dangerous tags/attributes). Requires `allowHtml: true` |
| `sanitizer` | `HtmlSanitizer` | — | Custom sanitizer provider for the main or `/core` entry |
| `allowedTags` | `string[]` | — | Extend default allowed tags when `sanitize: true` |
| `allowedAttributes` | `Record<string, string[]>` | — | Extend default per-tag attributes when `sanitize: true` |
| `allowStyle` | `boolean` | `false` | Allow a restricted set of inline style properties when `sanitize: true` |
| `gfm` | `boolean` | `false` | Enable GFM features (tables, task lists, strikethrough, autolinks) |
| `breaks` | `boolean` | `false` | Convert bare `\n` to `<br>` |
| `maxNestingDepth` | `number` | `100` | Limit nested blockquotes/lists; hard-capped at 100 |
| `maxInputLength` | `number` | — | Reject longer input. `ugc: true` has a hard maximum of 1,000,000 UTF-16 code units |
| `lazyImages` | `boolean` | `true` | Add `loading="lazy"` to all images |
| `safeLinks` | `boolean \| object` | `false` | Add `rel="nofollow noopener noreferrer"` + `target="_blank"` to external links. Object: `{ externalRel?, externalTarget?, baseUrl? }` |
| `ugc` | `boolean` | `false` | Enforces safe links, disables raw HTML, and limits input to 1,000,000 code units |
| `blocks` | `BlockRule[]` | — | Select block rules. Import `createParser` from `/core` for a bundle containing only those rules |
| `renderer` | `Partial<Renderer>` | — | Override default renderer methods |
| `plugins` | `MarkdownPlugin[]` | `[]` | Plugins to extend the parser |

### HTML Sanitization

Import the `/sanitized` entry to use the built-in structural sanitizer:

```typescript
import { createParser } from '@lpm.dev/neo.markdown/sanitized'

const parser = createParser({
  allowHtml: true,
  sanitize: true,
})

parser.parse('<script>alert("xss")</script>')  // script stripped entirely
parser.parse('<img onerror="hack" src="x">')   // onerror stripped, tag kept
parser.parse('<a href="javascript:evil">click</a>')  // href stripped
parser.parse('<details><summary>OK</summary>Safe</details>')  // preserved
```

`allowStyle: true` permits `color`, `background-color`, `font-style`, `font-weight`, `text-align`, `text-decoration`, and `white-space`.
The sanitizer removes layout properties, CSS expressions, and URL values.

### User-Generated Content

Use UGC mode for READMEs, comments, and other untrusted Markdown:

```typescript
const parser = createParser({
  ugc: true,  // safe links, no raw HTML, and a fixed input limit
})
```

### Tree-Shakeable Blocks

Import only the block rules you need:

```typescript
import { createParser } from '@lpm.dev/neo.markdown/core'
import { heading, paragraph, code, list } from '@lpm.dev/neo.markdown/blocks'

const parser = createParser({
  blocks: [heading, paragraph, code, list],  // skip tables, hr, html, etc.
})
```

The main entry includes the complete default rule set so `createParser()` works without configuration. Use the `/core` factory with explicit `/blocks` imports when bundle-level removal matters.

## Plugins

Plugins extend the parser with custom tokenization rules, renderer overrides, and transforms. A plugin is a plain function — no class inheritance, no middleware chains.

```typescript
import { createParser } from '@lpm.dev/neo.markdown'
import { tocPlugin } from '@lpm.dev/neo.markdown/plugins/toc'
import { embedPlugin } from '@lpm.dev/neo.markdown/plugins/embeds'
import { copyCodePlugin } from '@lpm.dev/neo.markdown/plugins/copy-code'

const parser = createParser({
  gfm: true,
  plugins: [
    tocPlugin({ maxDepth: 3 }),
    embedPlugin({ youtube: true, twitter: true, autoEmbed: true }),
    copyCodePlugin(),
  ]
})

const html = parser.parse(markdown)
```

### Highlight Plugin

Syntax highlighting for code blocks via `@lpm.dev/neo.highlight`.

```bash
lpm install @lpm.dev/neo.highlight
```

```typescript
import { highlightPlugin } from '@lpm.dev/neo.markdown/plugins/highlight'
import { tokenize, renderToHTML, getThemeStylesheet } from '@lpm.dev/neo.highlight'
import { javascript, typescript, python } from '@lpm.dev/neo.highlight/grammars'
import { githubDark } from '@lpm.dev/neo.highlight/themes/github-dark'

const html = parse(markdown, {
  plugins: [
    highlightPlugin({
      grammars: [javascript, typescript, python],
      tokenize,
      renderToHTML,
      getThemeStylesheet,
      theme: githubDark,
      lineNumbers: true,
    })
  ]
})
```

Code block meta strings are parsed for highlight line annotations:

````markdown
```typescript {1,3-5} title="example.ts"
const a = 1
const b = 2
const c = 3
```
````

The `lang` and `meta` are split automatically — `lang: "typescript"`, `meta: "{1,3-5} title=\"example.ts\""`.

### Embed Plugin

YouTube, Vimeo, Twitter/X, CodeSandbox, CodePen, GitHub Gist, and Loom embeds with privacy-enhanced defaults, responsive containers, and GDPR consent mode.

```typescript
import {
  embedPlugin,
  initializeEmbeds,
} from '@lpm.dev/neo.markdown/plugins/embeds'

const html = parse(markdown, {
  plugins: [
    embedPlugin({
      youtube: { privacyEnhanced: true },  // youtube-nocookie.com (default)
      vimeo: { dnt: true },                // Do Not Track (default)
      twitter: { dnt: true, theme: 'dark' },
      codesandbox: true,
      codepen: true,
      gist: true,
      loom: true,
      autoEmbed: true,   // bare URLs → embeds
      responsive: true,  // 16:9 container (default)
      consent: false,     // GDPR consent placeholder
    })
  ]
})
```

After the rendered HTML mounts, initialize the consent buttons and external embed clients:

```typescript
const cleanup = initializeEmbeds()

// When the rendered root unmounts, run this.
cleanup()
```

The initializer handles consent clicks, Gist frames, and Twitter widgets. It returns a no-op cleanup function during server rendering.

**Directive syntax:**

```markdown
::youtube[dQw4w9WgXcQ]
::vimeo[53373707]{title="My Video"}
::tweet[1234567890]
::codesandbox[my-sandbox-id]
::codepen[pen-id]{user="username"}
::gist[abc123def]{user="username" file="index.ts"}
::loom[video-hash]
```

**Auto-embed:** A paragraph containing only a supported URL is automatically converted to an embed.

**GDPR consent mode:** With `consent: true`, embeds render as a "Click to load external content" button. The actual embed loads only after user interaction.

**React components** are also available:

```tsx
import { YouTube, Vimeo, Tweet, CodeSandbox, CodePen, Loom } from '@lpm.dev/neo.markdown/plugins/embeds/react'

<YouTube id="dQw4w9WgXcQ" />
<Vimeo id="53373707" />
<Tweet id="1234567890" theme="dark" />
```

React components include IntersectionObserver lazy loading, script deduplication (Tweet), and proper cleanup on unmount.

### TOC Plugin

Heading anchors, slug IDs, and table of contents extraction.

```typescript
import { tocPlugin } from '@lpm.dev/neo.markdown/plugins/toc'
import type { TocEntry } from '@lpm.dev/neo.markdown/plugins/toc'

let toc: TocEntry[] = []

const html = parse(markdown, {
  plugins: [
    tocPlugin({
      maxDepth: 3,
      anchorLinks: true,
      anchorClass: 'anchor',
      onToc: (entries) => { toc = entries },
    })
  ]
})

// toc = [
//   { level: 1, text: 'Title', id: 'title' },
//   { level: 2, text: 'Section 1', id: 'section-1' },
//   ...
// ]
```

**Output:**

```html
<h1 id="title"><a class="anchor" href="#title">Title</a></h1>
<h2 id="section-1"><a class="anchor" href="#section-1">Section 1</a></h2>
```

Duplicate headings get suffixed automatically: `intro`, `intro-1`, `intro-2`.

### Copy-Code Plugin

Injects an inert copy-to-clipboard button into every `<pre>` code block. The plugin does not emit inline JavaScript. Install the delegated client initializer after mounting the rendered HTML.

```typescript
import {
  copyCodePlugin,
  initializeCopyCode,
} from '@lpm.dev/neo.markdown/plugins/copy-code'

const html = parse(markdown, {
  plugins: [
    copyCodePlugin({
      buttonText: 'Copy',
      buttonClass: 'copy-code-button',
      wrapperClass: 'code-block',
    })
  ]
})

// Client entry point; call once and retain the cleanup function if needed.
const cleanupCopyCode = initializeCopyCode()
```

**Output:**

```html
<div class="code-block" data-copy-code-wrapper>
  <button class="copy-code-button" type="button" data-copy-code>Copy</button>
  <pre><code>...</code></pre>
</div>
```

## Writing Custom Plugins

A plugin is a function that receives a `PluginBuilder`:

```typescript
import type { MarkdownPlugin } from '@lpm.dev/neo.markdown'

const myPlugin: MarkdownPlugin = (builder) => {
  // Override how code blocks render
  builder.setRenderer('code', (token) => {
    return `<pre class="custom">${token.text}</pre>\n`
  })
}
```

### PluginBuilder API

| Method | Description |
|--------|-------------|
| `addBlockRule(rule)` | Add a custom block-level tokenization rule |
| `addInlineRule(rule)` | Add a custom inline tokenization rule |
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
    priority: 'before:paragraph',
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

Rules support numeric priority (higher = tried first) or positional constraints such as `'before:paragraph'` and `'after:code'`. A rule that can interrupt a paragraph should provide a cheap `starts()` check. Every successful rule must return a non-empty `raw` value that is an exact source prefix; invalid results throw instead of risking an infinite loop.

### Custom Inline Rule

```typescript
const highlightPlugin: MarkdownPlugin = (builder) => {
  builder.addInlineRule({
    name: 'highlight',
    priority: 'before:em',
    triggerChars: [61], // '=' char code
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

Inline priorities can target `escape`, `code`, `strong`, `em`, `del`, `link`, `html`, `br`, `autolink`, or `text`.

### Token Transform

```typescript
const removeHr: MarkdownPlugin = (builder) => {
  builder.addTokenTransform((tokens) =>
    tokens.filter((t) => t.type !== 'hr')
  )
}
```

### HTML Transform

```typescript
const addWrapper: MarkdownPlugin = (builder) => {
  builder.addHtmlTransform((html) =>
    `<article class="prose">${html}</article>`
  )
}
```

## Supported Syntax

### Block elements

```markdown
# Heading 1
## Heading 2

Paragraph text with **bold**, *italic*, and `code`.

> Blockquote

- Unordered list
- Item two

1. Ordered list
2. Item two

    Code block (indented)

```code block (fenced)```

---

| Table | Header |
|-------|--------|
| Cell  | Cell   |

- [x] Task list item
- [ ] Unchecked item
```

### Inline elements

```markdown
**bold** or __bold__
*italic* or _italic_
~~strikethrough~~
`inline code`
[link text](https://example.com)
![alt text](image.png)
<https://autolink.example.com>
```

## Presets

```typescript
// Core Markdown-subset preset (GFM extensions disabled)
import { parse } from '@lpm.dev/neo.markdown/commonmark'

// GFM preset (GitHub Flavored Markdown — tables, task lists, strikethrough)
import { parse } from '@lpm.dev/neo.markdown/gfm'
```

## Sub-path Imports

| Import | Description |
|--------|-------------|
| `@lpm.dev/neo.markdown` | Main entry — `parse()` and `createParser()` |
| `@lpm.dev/neo.markdown/core` | Core classes (Tokenizer, InlineTokenizer, HtmlRenderer, PluginBuilderImpl) |
| `@lpm.dev/neo.markdown/blocks` | Individual block rules for tree-shaking (`heading`, `paragraph`, `code`, `list`, etc.) |
| `@lpm.dev/neo.markdown/inline` | Inline token types and InlineTokenizer |
| `@lpm.dev/neo.markdown/commonmark` | CommonMark preset |
| `@lpm.dev/neo.markdown/gfm` | GFM preset |
| `@lpm.dev/neo.markdown/plugins/highlight` | Syntax highlighting plugin |
| `@lpm.dev/neo.markdown/plugins/embeds` | Embed plugin (YouTube, Vimeo, Twitter, CodeSandbox, CodePen, Gist, Loom) |
| `@lpm.dev/neo.markdown/plugins/embeds/react` | React embed components with IntersectionObserver |
| `@lpm.dev/neo.markdown/plugins/toc` | Table of contents plugin |
| `@lpm.dev/neo.markdown/plugins/copy-code` | Copy-to-clipboard button plugin |

## Conformance

This package implements a Markdown subset; it does not claim full CommonMark or GFM compliance. The mandatory CommonMark 0.31.2 test locks the exact 313 passing examples out of 652 official examples. It normalizes void-tag style and quote entities. Selected official GFM 0.29 extension fixtures are also mandatory. Structural containers and full delimiter-stack parsing remain future work.

## Migration from marked

```typescript
// Before (marked)
import { marked } from 'marked'
const html = marked('# Hello')

// After (neo.markdown)
import { parse } from '@lpm.dev/neo.markdown'
const html = parse('# Hello')
```

## Migration from markdown-it

```typescript
// Before (markdown-it)
import MarkdownIt from 'markdown-it'
const md = new MarkdownIt()
const html = md.render('# Hello')

// After (neo.markdown)
import { createParser } from '@lpm.dev/neo.markdown'
const parser = createParser()
const html = parser.parse('# Hello')
```

## Migration from rehype-pretty-code + rehype-slug

If you're using the remark/rehype stack for syntax highlighting, heading anchors, and embeds, neo.markdown replaces the entire chain:

```typescript
// Before — remark/rehype stack
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkRehype from 'remark-rehype'
import rehypePrettyCode from 'rehype-pretty-code'  // Shiki ~1MB
import rehypeSlug from 'rehype-slug'
import rehypeAutolinkHeadings from 'rehype-autolink-headings'
import rehypeStringify from 'rehype-stringify'

const result = await unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype)
  .use(rehypePrettyCode, { theme: 'github-dark' })
  .use(rehypeSlug)
  .use(rehypeAutolinkHeadings)
  .use(rehypeStringify)
  .process(markdown)
```

```typescript
// After — neo.markdown (one import, one parser, done)
import { createParser } from '@lpm.dev/neo.markdown'
import { highlightPlugin } from '@lpm.dev/neo.markdown/plugins/highlight'
import { tocPlugin } from '@lpm.dev/neo.markdown/plugins/toc'
import { tokenize, renderToHTML, getThemeStylesheet } from '@lpm.dev/neo.highlight'
import { javascript, typescript } from '@lpm.dev/neo.highlight/grammars'
import { githubDark } from '@lpm.dev/neo.highlight/themes/github-dark'

const parser = createParser({
  gfm: true,
  plugins: [
    highlightPlugin({
      grammars: [javascript, typescript],
      tokenize,
      renderToHTML,
      getThemeStylesheet,
      theme: githubDark,
    }),
    tocPlugin({ maxDepth: 3 }),
  ]
})

const html = parser.parse(markdown)
```

**What replaces what:**

| rehype plugin | neo.markdown equivalent |
|--------------|------------------------|
| `rehype-pretty-code` (Shiki) | `highlightPlugin()` with `@lpm.dev/neo.highlight` |
| `rehype-slug` | `tocPlugin({ anchorLinks: false })` |
| `rehype-autolink-headings` | `tocPlugin({ anchorLinks: true })` |
| Custom embed components | `embedPlugin({ youtube: true, twitter: true })` |
| `rehype-raw` + `rehype-sanitize` | `/sanitized` with `allowHtml: true, sanitize: true` |

## License

MIT
