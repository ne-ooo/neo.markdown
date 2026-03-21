# @lpm.dev/neo.markdown

Modern, tree-shakeable markdown parser. Zero dependencies, TypeScript-first, XSS-safe by default. Extensible via a simple plugin system.

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

- **CommonMark** compliant parsing
- **GFM** (GitHub Flavored Markdown) — tables, task lists, strikethrough
- **XSS protection** — HTML escaped by default
- **Plugin system** — highlight, embeds, TOC, copy-code, or write your own
- **Tree-shakeable** — sub-path imports for each layer
- **Zero dependencies**
- **TypeScript** — full type declarations

## API

### `parse(markdown, options?)`

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
| `gfm` | `boolean` | `false` | Enable GFM features (tables, strikethrough, task lists) |
| `breaks` | `boolean` | `false` | Convert `\n` to `<br>` |
| `plugins` | `MarkdownPlugin[]` | `[]` | Plugins to extend the parser |

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

YouTube, Vimeo, and Twitter/X embeds via directive syntax or bare-URL auto-embed.

```typescript
import { embedPlugin } from '@lpm.dev/neo.markdown/plugins/embeds'

const html = parse(markdown, {
  plugins: [
    embedPlugin({
      youtube: { privacyEnhanced: true },
      twitter: true,
      vimeo: true,
      autoEmbed: true,
    })
  ]
})
```

**Directive syntax:**

```markdown
::youtube[dQw4w9WgXcQ]
::vimeo[53373707]{title="My Video" width="640"}
::tweet[1234567890]
```

**Auto-embed:** A paragraph containing only a YouTube, Vimeo, or Twitter URL is automatically converted to an embed:

```markdown
https://www.youtube.com/watch?v=dQw4w9WgXcQ
```

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

Injects a copy-to-clipboard button into every `<pre>` code block.

```typescript
import { copyCodePlugin } from '@lpm.dev/neo.markdown/plugins/copy-code'

const html = parse(markdown, {
  plugins: [
    copyCodePlugin({
      buttonText: 'Copy',
      buttonClass: 'copy-code-button',
      wrapperClass: 'code-block',
    })
  ]
})
```

**Output:**

```html
<div class="code-block">
  <button class="copy-code-button" type="button">Copy</button>
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

Rules support numeric priority (higher = tried first) or positional constraints: `'before:paragraph'`, `'after:code'`.

### Custom Inline Rule

```typescript
const highlightPlugin: MarkdownPlugin = (builder) => {
  builder.addInlineRule({
    name: 'highlight',
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
// CommonMark preset (strict spec compliance)
import { parse } from '@lpm.dev/neo.markdown/commonmark'

// GFM preset (GitHub Flavored Markdown — tables, task lists, strikethrough)
import { parse } from '@lpm.dev/neo.markdown/gfm'
```

## Sub-path Imports

| Import | Description |
|--------|-------------|
| `@lpm.dev/neo.markdown` | Main entry — `parse()` and `createParser()` |
| `@lpm.dev/neo.markdown/core` | Core classes (Tokenizer, InlineTokenizer, HtmlRenderer, PluginBuilderImpl) |
| `@lpm.dev/neo.markdown/blocks` | Block token types and Tokenizer |
| `@lpm.dev/neo.markdown/inline` | Inline token types and InlineTokenizer |
| `@lpm.dev/neo.markdown/commonmark` | CommonMark preset |
| `@lpm.dev/neo.markdown/gfm` | GFM preset |
| `@lpm.dev/neo.markdown/plugins/highlight` | Syntax highlighting plugin |
| `@lpm.dev/neo.markdown/plugins/embeds` | YouTube/Vimeo/Twitter embed plugin |
| `@lpm.dev/neo.markdown/plugins/toc` | Table of contents plugin |
| `@lpm.dev/neo.markdown/plugins/copy-code` | Copy-to-clipboard button plugin |

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
| `rehype-raw` + `rehype-sanitize` | Built-in XSS protection (default) |

## License

MIT
