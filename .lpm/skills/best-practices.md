---
name: best-practices
description: Performance, security, tree-shaking, ugc, safeLinks, selective blocks, and token pipeline patterns for @lpm.dev/neo.markdown
version: "2.0.0"
globs:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.js"
  - "**/*.jsx"
---

# Best Practices for @lpm.dev/neo.markdown

## Performance

### Reuse parser instances

Optionless `parse()` calls reuse one lazy parser. Calls that pass options create a new parser. For repeated calls with the same options, use `createParser()`:

```typescript
// Good — parser created once, reused many times
import { createParser } from '@lpm.dev/neo.markdown'

const parser = createParser()
const articles = markdownFiles.map(md => parser.parse(md))

// Also cached because these calls do not pass options
import { parse } from '@lpm.dev/neo.markdown'

const articles = markdownFiles.map(md => parse(md))
```

The sanitized, GFM, and CommonMark `parse()` entries also cache their optionless parser. Each entry has a separate cache.

### Use sub-path imports for smaller bundles

The package is tree-shakeable (`"sideEffects": false`). Import from sub-paths when you only need types or a selective parser:

```typescript
// Default entry includes the complete built-in parser
import { parse } from '@lpm.dev/neo.markdown'

// Type-only imports emit no JavaScript
import type { HeadingToken, ListToken, TableToken } from '@lpm.dev/neo.markdown/blocks'

import type { LinkToken, StrongToken, EmToken } from '@lpm.dev/neo.markdown/inline'
```

### Use selective block loading for smaller bundles

If you only need a subset of block types (e.g., a comment renderer that only needs paragraphs, emphasis, and links), use the `blocks` option to include only the rules you need. Unused block rules are tree-shaken:

```typescript
import { createParser } from '@lpm.dev/neo.markdown/core'
import { heading, paragraph, code, list } from '@lpm.dev/neo.markdown/blocks'

const parser = createParser({
  blocks: [heading, paragraph, code, list],
})
```

The main entry imports all default block rules. Passing `blocks` there changes runtime behavior but cannot remove those default imports from the entry bundle.

## Security

### HTML handling — three modes

1. **`allowHtml: false` (default):** HTML blocks are entity-escaped (`<` → `&lt;`). Safe for untrusted input.

2. **`allowHtml: true, sanitize: true`:** The `/sanitized` entry keeps safe tags and removes dangerous HTML.

3. **`allowHtml: true` (without sanitize):** Raw HTML passes through verbatim. Only use with trusted content.

```typescript
import { parse } from '@lpm.dev/neo.markdown'
import { parse as parseSanitized } from '@lpm.dev/neo.markdown/sanitized'

// Safe — all HTML escaped
parse(userInput)

// Safe — HTML allowed but sanitized
parseSanitized(userInput, { allowHtml: true, sanitize: true })

// Unsafe — only use with trusted content
parse(trustedContent, { allowHtml: true })
```

### Use `ugc: true` for untrusted content

For user-generated content, use the `ugc` shorthand. It enables safe links, disables raw HTML, and limits the input size:

```typescript
const html = parse(userComment, { ugc: true })
```

UGC mode limits input to 1,000,000 UTF-16 code units. A larger `maxInputLength` value cannot increase this limit.

### Use `safeLinks: true` for README rendering

When rendering README files or documentation, enable `safeLinks` to add `rel="noopener noreferrer"` and `target="_blank"` to external links:

```typescript
const html = parse(readme, { safeLinks: true })

// With baseUrl for resolving relative links
const html = parse(readme, {
  safeLinks: { baseUrl: 'https://github.com/org/repo/blob/main/' },
})
```

### Sanitization order — sanitizer runs before plugin HTML transforms

The sanitizer runs before plugin HTML transforms. Only install trusted plugins because their transforms run outside the user-HTML sanitizer. `copyCodePlugin` emits escaped, inert markup and requires an explicit client initializer; it does not emit inline scripts.

If `allowStyle` is true, the sanitizer permits only color, font, text, and white-space properties. It removes layout properties, expressions, and URL values.

The embed plugin emits inert consent and Gist markup. After the rendered HTML mounts, call `initializeEmbeds()` to activate consent, Gist, and Twitter output.

```typescript
import { createParser } from '@lpm.dev/neo.markdown/sanitized'

// Sanitizer cleans user HTML, then copy-code adds escaped inert markup
const parser = createParser({
  allowHtml: true,
  sanitize: true,
  plugins: [copyCodePlugin()],
})
```

### Dangerous protocols are always blocked

Regardless of options, the renderer blocks dangerous URL protocols in links and images: `javascript:`, `data:`, `vbscript:`, `file:`, `about:`, `blob:`. This protection is in the `escape.ts` utilities and is always active.

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
