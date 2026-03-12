# @lpm.dev/neo.markdown

Modern, tree-shakeable markdown parser. Zero dependencies, TypeScript-first, XSS-safe by default.

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
| `preset` | `'commonmark' \| 'gfm'` | `'gfm'` | Feature preset |
| `breaks` | `boolean` | `false` | Convert `\n` to `<br>` |

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
import { createParser } from '@lpm.dev/neo.markdown/commonmark'

// GFM preset (GitHub Flavored Markdown — tables, task lists, strikethrough)
import { createParser } from '@lpm.dev/neo.markdown/gfm'
```

## Sub-path Imports

```typescript
// Core parser and renderer
import { createParser, HtmlRenderer } from '@lpm.dev/neo.markdown/core'

// Block parsers only
import { /* block parsers */ } from '@lpm.dev/neo.markdown/blocks'

// Inline parsers only
import { /* inline parsers */ } from '@lpm.dev/neo.markdown/inline'
```

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

## License

MIT
