---
name: anti-patterns
description: Common mistakes and silent failures when using @lpm.dev/neo.markdown — prioritized wrong/correct pairs
version: "1.2.0"
globs:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.js"
  - "**/*.jsx"
---

# Anti-Patterns

### [FIXED in v1.2.0] Custom renderer option — now works

Previously, the `renderer` option was silently ignored. As of v1.2.0, it is applied correctly. The renderer option is merged before plugin overrides, so plugins take precedence.

```typescript
// Works in v1.2.0+
const parser = createParser({
  renderer: {
    heading: (token) => `<h${token.level} class="custom">${token.text}</h${token.level}>\n`
  }
})
```

Override priority: `renderer` option < plugin `setRenderer()` calls (plugins win). If you use both, the plugin override replaces the option-level override for the same method.

### [FIXED in v1.2.0] sanitize / allowedTags / allowedAttributes — now works

Previously, these options existed in the types but had no effect. As of v1.2.0, the built-in server-side sanitizer is fully functional.

```typescript
import { parse } from '@lpm.dev/neo.markdown'

// Allow HTML but sanitize it (strips <script>, event handlers, etc.)
const safeHtml = parse(userInput, { allowHtml: true, sanitize: true })

// Extend the default allowed tags (defaults include p, strong, em, a, ul, ol, li, etc.)
const safeHtml = parse(userInput, {
  allowHtml: true,
  sanitize: true,
  allowedTags: ['details', 'summary', 'video'],  // added ON TOP of defaults
})

// allowedAttributes is a per-tag Record
const safeHtml = parse(userInput, {
  allowHtml: true,
  sanitize: true,
  allowedAttributes: {
    a: ['href', 'title'],
    img: ['src', 'alt', 'width', 'height'],
    video: ['src', 'controls'],
  },
})
```

Note: `sanitize: true` requires `allowHtml: true` — without `allowHtml`, HTML is already entity-escaped so there is nothing to sanitize. External sanitizers like DOMPurify are no longer needed for standard use cases.

### [FIXED in v1.2.0] gfm option — now gates GFM features correctly

Previously, the `gfm` option was stored but never checked — GFM features were always active. As of v1.2.0, tables, strikethrough, and autolinks are gated on the `gfm` option.

```typescript
// GFM features enabled
const parser = createParser({ gfm: true })
parser.parse('| A | B |\n|---|---|\n| 1 | 2 |') // Renders table

// Strict CommonMark — no GFM extensions
const parser = createParser({ gfm: false })
parser.parse('| A | B |\n|---|---|\n| 1 | 2 |') // No table, treated as paragraph
parser.parse('~~deleted~~')                       // No strikethrough
```

Note: `gfm` defaults to `false`. Set `gfm: true` explicitly to enable tables, strikethrough, and autolinks.

### [FIXED in v1.2.0] breaks option — now produces `<br>` on bare newlines

Previously, the `breaks` option was not wired into `InlineTokenizer`. As of v1.2.0, bare newlines produce `<br>` when `breaks: true`.

```typescript
// Bare newlines become <br>
const html = parse('Line 1\nLine 2', { breaks: true })
// Output: <p>Line 1<br>Line 2</p>

// Without breaks (default), only two trailing spaces + newline produces <br>
const html = parse('Line 1\nLine 2')
// Output: <p>Line 1\nLine 2</p>

const html = parse('Line 1  \nLine 2')
// Output: <p>Line 1<br>Line 2</p>
```

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

### [FIXED in v1.2.0] Block-selection API — now implemented

Previously, the `blocks` option was planned but not implemented. As of v1.2.0, individual block rules are exported from `@lpm.dev/neo.markdown/blocks` and can be selectively included via the `blocks` option. This enables tree-shaking for smaller bundles.

```typescript
import { createParser } from '@lpm.dev/neo.markdown'
import { heading, paragraph, code, list } from '@lpm.dev/neo.markdown/blocks'

// Only include the block rules you need — unused rules are tree-shaken
const parser = createParser({
  blocks: [heading, paragraph, code, list],
})
```

If the `blocks` option is omitted, all block rules are included (same behavior as before).
