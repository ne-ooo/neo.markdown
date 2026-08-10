---
name: anti-patterns
description: Common mistakes and silent failures when using @lpm.dev/neo.markdown — prioritized wrong/correct pairs
version: "2.0.0"
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

These options became functional in v1.2.0. In v2.0.0, the built-in sanitizer moved to the `/sanitized` entry.

```typescript
import { parse } from '@lpm.dev/neo.markdown/sanitized'

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

`sanitize: true` requires `allowHtml: true`. The main and `/core` entries also require a custom `sanitizer` provider.

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

### [FIXED in v1.2.1] Sanitizer strips plugin-injected HTML when sanitize runs after plugins

Previously, when `sanitize: true` was used with plugins like `copyCodePlugin`, the sanitizer ran after plugin HTML transforms. This stripped plugin elements and broke copy-code functionality.

Wrong (pre-v1.2.1 behavior):

```
1. Parse markdown → tokens
2. Render tokens → HTML
3. Plugin HTML transforms add elements
4. Sanitizer strips those elements → plugin output is gone
```

Correct (v1.2.1+ behavior):

```
1. Parse markdown → tokens
2. Render tokens → HTML
3. Sanitizer runs on user-authored HTML
4. Trusted plugin HTML transforms run after sanitization
```

Fixed: the sanitizer now runs before plugin HTML transforms. The current copy-code plugin emits escaped inert markup and uses an explicit client initializer instead of inline JavaScript.

### [HIGH] Calling parse() with options in a loop

Wrong:

```typescript
import { parse } from '@lpm.dev/neo.markdown'

// Each call with options creates a new parser.
const results = documents.map(doc => parse(doc, { gfm: true }))
```

Correct:

```typescript
import { createParser } from '@lpm.dev/neo.markdown'

const parser = createParser({ gfm: true })
const results = documents.map(doc => parser.parse(doc))
```

Optionless `parse()` calls reuse one lazy parser. Calls with options stay isolated and create a parser for each call.

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

Individual block rules are exported from `@lpm.dev/neo.markdown/blocks`. Use them with the generic `/core` parser so unselected rule implementations are absent from the consumer bundle.

```typescript
import { createParser } from '@lpm.dev/neo.markdown/core'
import { heading, paragraph, code, list } from '@lpm.dev/neo.markdown/blocks'

// Only include the block rules you need — unused rules are tree-shaken
const parser = createParser({
  blocks: [heading, paragraph, code, list],
})
```

The main entry includes all default rules. Its `blocks` option is useful for runtime behavior selection, but it is not a bundle-size boundary.
