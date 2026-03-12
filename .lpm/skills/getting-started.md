---
name: getting-started
description: Import patterns, working API surface, and what actually works in @lpm.dev/neo.markdown
version: "1.0.0"
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

// Reuse across multiple calls — no re-initialization cost
const html1 = parser.parse(doc1)
const html2 = parser.parse(doc2)
```

## What Actually Works

The `ParserOptions` type defines several options, but **only `allowHtml` has a runtime effect** in the current version:

```typescript
interface ParserOptions {
  allowHtml?: boolean         // ✅ WORKS — gates HTML block tokenization
  sanitize?: boolean          // ❌ NOT IMPLEMENTED — accepted but ignored
  allowedTags?: string[]      // ❌ NOT IMPLEMENTED — accepted but ignored
  allowedAttributes?: string[] // ❌ NOT IMPLEMENTED — accepted but ignored
  gfm?: boolean               // ❌ NOT IMPLEMENTED — GFM features are always active
  breaks?: boolean             // ❌ NOT IMPLEMENTED — InlineTokenizer ignores this
  renderer?: Partial<Renderer> // ❌ NOT IMPLEMENTED — constructor ignores this
}
```

The only meaningful call patterns are:

```typescript
// Default: all HTML escaped, GFM features active (tables, strikethrough, task lists, autolinks)
const html = parse('# Hello')

// Allow raw HTML to pass through unescaped
const html = parse('<div>Raw HTML</div>', { allowHtml: true })
```

## GFM Features Are Always Active

Tables, task lists, strikethrough (`~~text~~`), and autolinks work regardless of whether `gfm` is set to `true` or `false`. The tokenizer always includes these patterns:

```typescript
// Tables render even without gfm: true
parse('| A | B |\n|---|---|\n| 1 | 2 |')
// => '<table><thead><tr><th>A</th><th>B</th></tr></thead>...'
```

## Presets

The `commonmark` and `gfm` presets are convenience wrappers that set default options and call `createParser()` internally. **They create a new parser on every call** — there is no way to get a reusable instance from a preset:

```typescript
// Convenience — but creates a new parser per call
import { parse } from '@lpm.dev/neo.markdown/gfm'
parse(md) // new MarkdownParser + Tokenizer + InlineTokenizer + HtmlRenderer each time

// For hot paths, use createParser directly
import { createParser } from '@lpm.dev/neo.markdown'
const parser = createParser()
parser.parse(md) // reuses existing instances
```

## Sub-path Exports

| Import Path | What You Get |
|-------------|-------------|
| `@lpm.dev/neo.markdown` | `parse`, `createParser`, `HtmlRenderer`, all types |
| `@lpm.dev/neo.markdown/core` | Core parser, tokenizers, renderer, types |
| `@lpm.dev/neo.markdown/blocks` | Block token types and `Tokenizer` class |
| `@lpm.dev/neo.markdown/inline` | Inline token types and `InlineTokenizer` class |
| `@lpm.dev/neo.markdown/commonmark` | CommonMark preset `parse` function |
| `@lpm.dev/neo.markdown/gfm` | GFM preset `parse` function |

The `blocks` and `inline` sub-paths export the **monolithic tokenizer classes** and type re-exports. They do not export individual block/inline functions for selective composition — that API is planned but not implemented.

## Working with Tokens

Access the AST for custom processing:

```typescript
import { createParser } from '@lpm.dev/neo.markdown'
import type { BlockToken, HeadingToken } from '@lpm.dev/neo.markdown'

const parser = createParser()
const tokens: BlockToken[] = parser.tokenize('# Hello\n\nA paragraph.')

// tokens[0] => { type: 'heading', level: 1, text: 'Hello', tokens: [...], raw: '# Hello\n' }

// Render tokens back to HTML
const html = parser.render(tokens)
```

The `Parser` interface exposes three methods:

```typescript
interface Parser {
  parse(markdown: string): string       // tokenize + render in one step
  tokenize(markdown: string): BlockToken[] // markdown → AST
  render(tokens: BlockToken[]): string   // AST → HTML
}
```
