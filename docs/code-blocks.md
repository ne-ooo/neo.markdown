# Code-block metadata and rendering hooks

The [presentation plugin](./code-presentation.md) supplies reusable captions, filenames, focus, and diff notation through these APIs.

Code tokens retain their existing `text`, `lang`, `meta`, and `raw` fields.
Fenced tokens also contain `info`, the exact text after the opening fence and before its line ending.
Markdown normalizes line endings and container indentation before it creates these tokens.

## Metadata

```typescript
import { parseCodeMetadata } from '@lpm.dev/neo.markdown'

const metadata = parseCodeMetadata(
  'title="API client" filename=src/client.ts lines start=20 {2,4-6}',
  10, // highest source line to select
)
metadata.attributes.title        // "API client"
metadata.attributes.lines        // true
metadata.attributes.start        // "20"
metadata.highlightLines          // [2, 4, 5, 6]
metadata.diagnostics              // []
```

Metadata supports whitespace-separated flags, `key=value` pairs, quoted values, and `{line,ranges}` selections.
Keys are case-sensitive ASCII identifiers, with underscores and hyphens permitted.
Values support Markdown escapes and entities. Quoted ranges remain values and do not select lines.
Flags contain `true`. Other values remain strings, including numbers and `false`.
Unknown keys remain available to applications. Duplicate keys use the last value and produce a diagnostic.

The parser accepts at most 16,384 UTF-16 code units and 256 entries.
Line expansion stops at 10,000 and the supplied source-line limit.
Malformed or truncated entries produce diagnostics with offsets into the metadata string.
Diagnostics do not replace the original metadata. Parsed objects, arrays, and diagnostics are immutable.

These attributes are data. They do not create HTML attributes, captions, file access, or executable commands automatically.

## Block context and wrappers

`renderCodeBlock` wraps the final code renderer, including a highlighting plugin.
It receives an immutable context and a function that renders the block.

```typescript
import {
  createParser,
  escapeHtml,
  getCodeBlockMetadata,
} from '@lpm.dev/neo.markdown'

const parser = createParser({
  renderCodeBlock(context, render) {
    const { attributes } = getCodeBlockMetadata(context)
    const title = attributes.title
    if (typeof title !== 'string') return render()
    return `<figure><figcaption>${escapeHtml(title)}</figcaption>${render()}</figure>`
  },
})
```

The context contains these fields:

| Field | Meaning |
| --- | --- |
| `source` | Code text after Markdown normalization |
| `language` | Trimmed, lowercase language spelling, before alias resolution |
| `rawLanguage` | Original `CodeToken.lang` value |
| `rawInfo` | Exact fence info, or `undefined` for tokens without it |
| `rawMeta` | Undecoded `CodeToken.meta`, with outer whitespace removed |
| `lineCount` | Physical lines, excluding a final empty line after a terminator |
| `token` | A frozen copy of the original code token |

`getCodeBlockMetadata(context)` parses on demand and uses weak context keys for its cache.
Metadata parsing stays outside parser bundles that do not use it.
`createCodeBlockContext(token)` creates the same context for custom integrations.
These helpers are available from the main and `/core` entries.

Plugins can register wrappers through `builder.addCodeBlockHook(hook)`.
The parser option runs outermost. Plugin hooks follow registration order, with the first registered hook outermost.
The innermost operation calls the final `Renderer.code(token, context)` implementation.
Existing one-argument code renderers remain valid.

A wrapper can omit `render()` to replace the block completely.
Repeated successful calls to `render()` within one hook reuse its result.
Every block render receives a separate context, including nested blocks and repeated documents.
Hooks also run for unknown languages, indented code, and tokens supplied to `parser.render()`.

Hooks must return HTML strings synchronously. Errors propagate to the caller.
Block hooks run before configured HTML sanitization and before document HTML transforms.
Hooks are trusted application code. Escape metadata and source values before inserting them into returned HTML.
The highlighting output limit does not include additional HTML from custom block wrappers.

## Per-block highlighting options

```typescript
import { createParser } from '@lpm.dev/neo.markdown'
import { highlightPlugin } from '@lpm.dev/neo.markdown/plugins/highlight'
import { tokenize, renderToHTML } from '@lpm.dev/neo.highlight'
import { javascript } from '@lpm.dev/neo.highlight/grammars/javascript'

const parser = createParser({
  plugins: [highlightPlugin({
    grammars: [javascript], tokenize, renderToHTML,
    renderOptions(context) {
      const start = Number(context.metadata.attributes.start)
      return {
        lineNumbers: context.metadata.attributes.lines === true,
        startLine: Number.isSafeInteger(start) && start > 0 ? start : 1,
        hooks: {
          line: ({ displayLine }) => ({
            attributes: { id: `example-line-${displayLine}` },
          }),
        },
      }
    },
  })],
})
```

The callback receives the block context, parsed `metadata`, the selected `grammar`, and its canonical `resolvedLanguage`.
It runs only for blocks with a registered grammar.
Allowed overrides are `lineNumbers`, `startLine`, `highlightLines`, `diffHighlight`, and `hooks`.
Other options, including resource limits, remain fixed by plugin configuration.
An empty `highlightLines` array disables metadata line selections for that block.
A per-block hooks object replaces the plugin-level hooks object.

Line selections and diff arrays use one-based source positions. `startLine` changes displayed numbers only.
The existing `{1,3-5}` notation still selects source lines.
The standalone `parseHighlightLines()` helper retains its legacy behavior. The metadata parser also respects quoted values.

Configuration callback failures report `stage: 'configure'` through `onError`.
Token and renderer failures retain the `tokenize` and `render` stages.
The existing `errorPolicy: 'plain'` produces escaped fallback code for these failures.
Outer block-hook errors propagate independently of the highlighting recovery policy.

The demo's **Code Metadata** template combines captions, filenames, line numbers, highlighting, and copy controls.
