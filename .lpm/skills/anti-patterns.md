---
name: anti-patterns
description: Common mistakes and silent failures when using @lpm.dev/neo.markdown — prioritized wrong/correct pairs
version: "1.1.0"
globs:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.js"
  - "**/*.jsx"
---

# Anti-Patterns

### [CRITICAL] Custom renderer option is silently ignored

Wrong:

```typescript
const parser = createParser({
  renderer: {
    heading: (token) => `<h${token.level} class="custom">${token.text}</h${token.level}>\n`
  }
})
// Output uses default HtmlRenderer — custom heading is never called
```

Correct:

```typescript
// The renderer option is not wired into the implementation.
// In src/core/parser.ts:30, the constructor always creates new HtmlRenderer()
// and ignores options.renderer entirely.
// Use tokenize + render with your own rendering logic instead:
const parser = createParser()
const tokens = parser.tokenize(markdown)

function renderTokens(tokens: BlockToken[]): string {
  return tokens.map(token => {
    if (token.type === 'heading') {
      return `<h${token.level} class="custom">${token.text}</h${token.level}>\n`
    }
    // ... handle other token types
    return parser.render([token]) // fallback to default for unhandled types
  }).join('')
}
```

`options.renderer` is accepted by `ParserOptions` types but the `MarkdownParser` constructor creates `new HtmlRenderer()` unconditionally and never reads the renderer option.

Source: `src/core/parser.ts:29-30` — `this.renderer = new HtmlRenderer()`

### [CRITICAL] sanitize / allowedTags / allowedAttributes have no effect

Wrong:

```typescript
// Looks safe — sanitize with allowlist
const parser = createParser({
  allowHtml: true,
  sanitize: true,
  allowedTags: ['p', 'strong', 'em', 'a'],
  allowedAttributes: ['href']
})
const html = parser.parse(userInput) // ⚠️ ALL HTML passes through unsanitized
```

Correct:

```typescript
import { parse } from '@lpm.dev/neo.markdown'
import DOMPurify from 'dompurify'

// Option 1: Don't allow HTML at all (default, safe)
const safeHtml = parse(userInput)

// Option 2: Allow HTML + sanitize externally
const rawHtml = parse(userInput, { allowHtml: true })
const safeHtml = DOMPurify.sanitize(rawHtml)
```

The `sanitize`, `allowedTags`, and `allowedAttributes` options exist in the `ParserOptions` type but are never read by any code path. There is no HTML tag/attribute filter in the codebase. The `escape.ts` utilities only handle entity escaping and URL protocol blocking.

Source: maintainer interview — "Accepted by the types but never implemented. There is no HTML tag/attribute whitelist filter anywhere in the codebase."

### [HIGH] gfm option has no effect — GFM features are always active

Wrong:

```typescript
// Expecting strict CommonMark with no GFM extensions
const parser = createParser({ gfm: false })
parser.parse('| A | B |\n|---|---|\n| 1 | 2 |')
// ⚠️ Table still renders — gfm flag is stored but never checked
```

Correct:

```typescript
// GFM features (tables, strikethrough, task lists, autolinks) are always active
// regardless of the gfm option value. The tokenizer always includes these patterns.
// There is no way to disable them in the current version.
const parser = createParser()
parser.parse('| A | B |\n|---|---|\n| 1 | 2 |') // Table renders
```

The `gfm` option is stored in `this.options` but the `Tokenizer` never checks it. Table tokenization, strikethrough, task lists, and autolinks are always in the parsing chain.

Source: maintainer interview — "The `gfm` option is stored but never checked. The only option that gates behavior is `allowHtml`."

### [HIGH] breaks option has no effect

Wrong:

```typescript
// Expecting newlines to become <br>
const html = parse('Line 1\nLine 2', { breaks: true })
// ⚠️ Output: <p>Line 1\nLine 2</p> — no <br> inserted
```

Correct:

```typescript
// The breaks option is not implemented. InlineTokenizer does not accept or read options.
// Only two trailing spaces + newline produces <br> (hardcoded pattern: / {2,}\n/):
const html = parse('Line 1  \nLine 2')
// Output: <p>Line 1<br>Line 2</p>
```

`InlineTokenizer` is constructed without options (`src/core/parser.ts:29`) and has a hardcoded `br` pattern that only matches two or more trailing spaces followed by a newline. The `breaks` option is never passed to it.

Source: `src/core/inline-tokenizer.ts:48` — InlineTokenizer constructor takes no arguments

### [HIGH] Calling parse() in a loop instead of reusing createParser()

Wrong:

```typescript
import { parse } from '@lpm.dev/neo.markdown'

// Each call creates: new MarkdownParser + new Tokenizer + new InlineTokenizer + new HtmlRenderer
const results = documents.map(doc => parse(doc, { gfm: true }))
```

Correct:

```typescript
import { createParser } from '@lpm.dev/neo.markdown'

const parser = createParser()
const results = documents.map(doc => parser.parse(doc))
```

`parse()` is a convenience wrapper that calls `createParser(options)` and then `parser.parse(markdown)` — four class instantiations per call. This degrades silently with no error or warning.

Source: `src/index.ts:41-43` — `const parser = createParser(options); return parser.parse(markdown)`

### [MEDIUM] tablerow / tablecell renderer coupling

Wrong:

```typescript
// If custom renderers are implemented in the future:
// Overriding tablecell to return <div> but not updating tablerow
renderer: {
  tablecell: (text, align, header) => `<div class="cell">${text}</div>`
  // tablerow still expects <td>/<th> children and wraps in <tr>
}
```

Correct:

```typescript
// tablecell output is collected into an array and passed to tablerow.
// If you override one, consider the contract with the other:
renderer: {
  tablecell: (text, align, header) => `<div class="cell">${text}</div>`,
  tablerow: (cells) => `<div class="row">${cells.join('')}</div>`
}
```

In `src/core/renderer.ts:132-148`, `table()` calls `tablecell()` for each cell, collects the returned strings, then passes that array to `tablerow()`. The type signature (`cells: string[]`) doesn't communicate that these are pre-rendered cell strings.

Source: `src/core/renderer.ts:132-148` — table rendering pipeline

### [MEDIUM] Using planned block-selection API that doesn't exist

Wrong:

```typescript
// This API appears in modernization plans but is NOT implemented
import { createParser } from '@lpm.dev/neo.markdown/core'
import { heading, paragraph } from '@lpm.dev/neo.markdown/blocks'

const parser = createParser({ blocks: [heading, paragraph] })
```

Correct:

```typescript
// The blocks and inline sub-paths export the monolithic Tokenizer/InlineTokenizer
// classes and type re-exports. There are no individual block/inline functions.
// src/blocks/index.ts says "Individual block implementations will be added in Phase 2"
import { createParser } from '@lpm.dev/neo.markdown'
import type { HeadingToken } from '@lpm.dev/neo.markdown/blocks'

const parser = createParser()
```

The `blocks` and `inline` sub-path exports only re-export types and the monolithic tokenizer classes. Individual block/inline functions for selective composition are planned but not implemented.

Source: `src/blocks/index.ts` — "Note: Individual block implementations will be added in Phase 2"
