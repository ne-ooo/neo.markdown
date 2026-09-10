---
name: authoring-and-plugins
description: Custom Markdown plugins, token APIs, code presentation, word selections, and structured document results
version: "3.0.0"
globs:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.js"
  - "**/*.jsx"
---

# Authoring and plugins

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

Use `starts()` when the rule can interrupt a paragraph. A successful block or inline rule must consume a non-empty source prefix in `raw`; the parser rejects invalid rule results.

### Custom Inline Rule

```typescript
const highlightPlugin: MarkdownPlugin = (builder) => {
  builder.addInlineRule({
    name: 'highlight',
    priority: 'before:em',
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

## Output efficiency

Use `styleMode: "class"` to omit generated style attributes from highlighted code.
Supply the matching theme stylesheet once per page. The default remains `"inline"`.
See [efficiency guidance](../../docs/efficiency.md) for stylesheet costs and runtime measurements.


## Code-block metadata and hooks

Use `getCodeBlockMetadata(context)` inside the parser's `renderCodeBlock(context, render)` hook.
Use `parseCodeMetadata(rawMeta, maxLines)` for standalone metadata parsing.
The context retains code source, normalized language, exact fence info, and raw metadata.
Escape metadata with `escapeHtml()` before inserting it into wrapper HTML.

Register plugin wrappers with `builder.addCodeBlockHook(hook)`.
Hooks compose around the final code renderer and run before HTML sanitization.
The highlight plugin's `renderOptions(context)` selects per-block line options and decorators.
Its context also contains parsed `metadata`, `grammar`, and `resolvedLanguage`.
See `docs/code-blocks.md` for examples, bounds, and recovery behavior.

## Code presentation

The optional `@lpm.dev/neo.markdown/plugins/code-presentation` entry exports `codePresentationPlugin()` and `getCodePresentationStyles()`.
The plugin renders captions, filenames, focus ranges, and explicit diff notation.
Pass syntax configuration through `codePresentationPlugin({ highlight: { grammars, tokenize, renderToHTML } })` instead of registering a separate highlight plugin.
Metadata accepts `caption`, `title`, `filename`, `lines`, `start`, `focus`, `diff`, `added`, `removed`, and `modified`.
With `diff` enabled, `+ ` and `- ` prefixes mark changed lines. Two spaces mark unchanged context lines.
The copy-code initializer excludes removed lines and presentation gutters.
The plugin preserves caller tokens and applies limits to original source, rendered lines, and complete figure HTML.
See `docs/code-presentation.md` for defaults, stylesheet setup, hook composition, and fallback behavior.

### Word highlighting

Use `mark="2:7-2:15"` to select text in a code block with the presentation plugin.
Positions use one-based lines and Unicode code-point columns after diff-prefix removal. The end is exclusive.
At most 256 ranges are accepted before merging. Invalid metadata reports a `mark` diagnostic and applies no word selections.
Word selections support plain, highlighted, and sanitized output. Copy controls preserve clean source.
Application `highlightRanges` use zero-based UTF-16 offsets instead. Per-block ranges override metadata, which overrides global ranges.
See `docs/word-highlighting.md` for examples, styles, and recovery behavior.

## Structured document results

Use `parser.parseDocument(markdown)` to return `{ html, stylesheets, diagnostics, toc }`.
Use `parser.renderDocument(tokens)` for caller-supplied tokens.
The main, sanitized, CommonMark, and GFM entries also export a top-level `parseDocument()` function.
Existing `parse()` and `render()` calls retain string output and style injection behavior.

Structured calls collect used plugin styles separately, including with `injectStyles: false`.
Supply `getThemeStylesheet` and a theme through the highlighting configuration to collect syntax CSS.
Use `tocPlugin()` to populate `result.toc`. Diagnostics contain plain text and optional code-block locations.
Results are immutable and JSON-compatible. Failed calls throw without returning partial results.

Custom plugins can use `builder.document` during structured calls. String calls expose no collection context.
See `docs/document-results.md` for contribution methods, limits, sanitization order, and nested-call behavior.

## Experimental plugin reuse

Import `defineIncrementalPlugin` and `createIncrementalMarkdown` from the same `@lpm.dev/neo.markdown/incremental` module instance.
Wrap each plugin with `{ protocol: 1, id: "unique-id", profile: "render" }` and set `pluginReuse: "declared"`.
Highlight, presentation, copy-code, and TOC support this path. Existing factories remain unchanged.
Use `session.reuse` to inspect the fixed reuse policy and bounded fallback reasons.

Register transforms, code hooks, and renderers during synchronous plugin setup through the documented `PluginBuilder` API.
Custom blocks, undeclared plugins, and caller renderer overrides retain complete parsing.
Late registration and same-session reentrancy close an eligible declared session.

Every update repeats all rendering, highlighting, sanitizer, and document callbacks.
Callbacks receive isolated tokens. Copies count toward cumulative work limits.
Reuse can increase update time because it copies tokens and still renders the complete document.
Read `docs/incremental.md` for executable examples, module identity rules, bounds, and cleanup.

### Pure inline rules

Declare pure inline rules with `profile: "inline"`, `effects: "none"`, and explicit `dependencies`.
Use `{ kind: "static" }` only for immutable dependencies.
For mutable dependencies, use `{ kind: "revision", read: () => revision }`.
Change the revision whenever external tokenization state changes, including changes that do not affect Markdown source.

Rules must return deterministic values without observable effects. Each result must transfer a fresh mutable token graph.
Revision getters must return a synchronous primitive string of at most 1,024 UTF-16 units.
Every accepted update reads revisions once in plugin order. Changes clear the complete inline cache and retain structural blocks.
`pluginInvalidations` counts transitions. Fallback sessions never read revisions.

During inline callbacks and revision reads, do not use `builder.document`, `builder.renderInline`, or `builder.renderBlock`.
The guards cover retained functions and other builders in the same session.
Register ordinary inline rule data through the documented fields. The runtime freezes a private metadata snapshot.
Unsupported token graphs remain uncached. Snapshot records, slots, property names, and strings count toward cache and work limits.
Read `docs/incremental.md` before enabling reuse for an application plugin.
