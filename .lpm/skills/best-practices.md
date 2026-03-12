---
name: best-practices
description: Performance, security, tree-shaking, and token pipeline patterns for @lpm.dev/neo.markdown
version: "1.0.0"
globs:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.js"
  - "**/*.jsx"
---

# Best Practices for @lpm.dev/neo.markdown

## Performance

### Reuse parser instances

`parse()` creates a new `MarkdownParser`, `Tokenizer`, `InlineTokenizer`, and `HtmlRenderer` on every call (`src/index.ts:41-43`). For any code path that parses more than once, use `createParser()`:

```typescript
// Good — parser created once, reused many times
import { createParser } from '@lpm.dev/neo.markdown'

const parser = createParser()
const articles = markdownFiles.map(md => parser.parse(md))

// Bad — 4 new class instances per iteration
import { parse } from '@lpm.dev/neo.markdown'

const articles = markdownFiles.map(md => parse(md))
```

This applies equally to preset imports — `@lpm.dev/neo.markdown/gfm` and `@lpm.dev/neo.markdown/commonmark` both create a new parser per call with no option for reuse.

### Use sub-path imports for smaller bundles

The package is tree-shakeable (`"sideEffects": false`). Import from sub-paths when you only need types:

```typescript
// Full bundle: ~29.6 KB gzipped
import { parse } from '@lpm.dev/neo.markdown'

// Block types only: ~12.6 KB gzipped (57% smaller)
import type { HeadingToken, ListToken, TableToken } from '@lpm.dev/neo.markdown/blocks'

// Inline types only: ~8.3 KB gzipped (71% smaller)
import type { LinkToken, StrongToken, EmToken } from '@lpm.dev/neo.markdown/inline'
```

## Security

### HTML handling is binary

The parser has two modes — there is no middle ground:

1. **`allowHtml: false` (default):** HTML blocks are never tokenized. They fall through to the paragraph parser and get entity-escaped (`<` → `&lt;`). This is safe for untrusted input.

2. **`allowHtml: true`:** Raw HTML passes through verbatim via `HtmlBlockToken`. The renderer returns `token.text` as-is with no filtering.

```typescript
// Safe — all HTML escaped
parse(userInput)

// Unsafe — all HTML passes through, including <script>, <iframe>, event handlers
parse(userInput, { allowHtml: true })
```

**Do not use `allowHtml: true` with untrusted input.** The `sanitize`, `allowedTags`, and `allowedAttributes` options exist in the type system but are not implemented — they provide no protection.

### Dangerous protocols are always blocked

Regardless of options, the renderer blocks dangerous URL protocols in links and images: `javascript:`, `data:`, `vbscript:`, `file:`, `about:`, `blob:`. This protection is in the `escape.ts` utilities and is always active.

### If you need HTML allowlisting

Since `sanitize` is not implemented, use an external sanitizer after parsing:

```typescript
import { parse } from '@lpm.dev/neo.markdown'
import DOMPurify from 'dompurify'

// Parse with HTML allowed, then sanitize externally
const rawHtml = parse(userContent, { allowHtml: true })
const safeHtml = DOMPurify.sanitize(rawHtml)
```

## Token Pipelines

### Use tokenize + render for AST transformations

When you need to inspect or transform the document before rendering (e.g., extract headings for a TOC, rewrite links, collect images):

```typescript
import { createParser } from '@lpm.dev/neo.markdown'
import type { BlockToken, HeadingToken } from '@lpm.dev/neo.markdown'

const parser = createParser()
const tokens = parser.tokenize(markdown)

// Extract headings for table of contents
const toc = tokens
  .filter((t): t is HeadingToken => t.type === 'heading')
  .map(t => ({ level: t.level, text: t.text }))

// Render the full document
const html = parser.render(tokens)
```

### Traverse nested tokens

Block tokens can nest: `blockquote` contains `BlockToken[]`, `list` contains items with `BlockToken[]`. Use recursive traversal:

```typescript
function walkBlocks(tokens: BlockToken[], visitor: (token: BlockToken) => void): void {
  for (const token of tokens) {
    visitor(token)
    if (token.type === 'blockquote') {
      walkBlocks(token.tokens, visitor)
    } else if (token.type === 'list') {
      for (const item of token.items) {
        walkBlocks(item.tokens, visitor)
      }
    }
  }
}
```

## TypeScript

### Import types from specific sub-paths

```typescript
import type { BlockToken, HeadingToken, ParagraphToken, ListToken, TableToken } from '@lpm.dev/neo.markdown/blocks'
import type { InlineToken, LinkToken, ImageToken, StrongToken } from '@lpm.dev/neo.markdown/inline'
import type { ParserOptions, Parser, Renderer } from '@lpm.dev/neo.markdown'
```

### Use type narrowing on token unions

`BlockToken` is a discriminated union on `type`. Use type guards for safe access:

```typescript
function processToken(token: BlockToken) {
  switch (token.type) {
    case 'heading':
      // token is HeadingToken — .level, .text, .tokens are available
      return `H${token.level}: ${token.text}`
    case 'code':
      // token is CodeToken — .lang, .text are available
      return `Code (${token.lang ?? 'plain'})`
    case 'table':
      // token is TableToken — .header, .align, .rows are available
      return `Table: ${token.header.length} columns`
  }
}
```

## Testing

### Compare output strings directly

The parser is deterministic — same input always produces same output:

```typescript
import { parse } from '@lpm.dev/neo.markdown'
import { expect, test } from 'vitest'

test('renders heading with emphasis', () => {
  expect(parse('# Hello **world**')).toBe('<h1>Hello <strong>world</strong></h1>\n')
})
```

### Test HTML escaping for security-sensitive code

```typescript
test('escapes script tags by default', () => {
  const html = parse('<script>alert("xss")</script>')
  expect(html).not.toContain('<script>')
  expect(html).toContain('&lt;script&gt;')
})

test('blocks javascript: protocol in links', () => {
  const html = parse('[click](javascript:alert(1))')
  expect(html).not.toContain('javascript:')
})
```
