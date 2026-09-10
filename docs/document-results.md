# Structured document results

`parseDocument()` returns document HTML, stylesheet assets, diagnostics, and TOC data together.
The existing `parse()` and `render()` methods still return strings with their existing plugin behavior.

## Basic use

```typescript
import { createParser } from '@lpm.dev/neo.markdown'
import { tocPlugin } from '@lpm.dev/neo.markdown/plugins/toc'
import { codePresentationPlugin } from '@lpm.dev/neo.markdown/plugins/code-presentation'
import { copyCodePlugin } from '@lpm.dev/neo.markdown/plugins/copy-code'

const parser = createParser({
  plugins: [tocPlugin(), codePresentationPlugin(), copyCodePlugin()],
})

const result = parser.parseDocument(markdown)
// result.html: string
// result.stylesheets: readonly { id: string; css: string }[]
// result.diagnostics: readonly DocumentDiagnostic[]
// result.toc: readonly { level: number; text: string; id: string }[]

const tokens = parser.tokenize(markdown)
const rendered = parser.renderDocument(tokens)
```

Each call returns new, immutable collections. Entries and nested diagnostic locations are immutable too.
The result contains only JSON-compatible values. An empty collection is an empty array.
Plugins supply collection entries. Without plugins, the result contains HTML and three empty arrays.

The top-level `parseDocument(markdown, parserOptions?, documentOptions?)` function is available from the main, sanitized, CommonMark, and GFM entries.
All parser factories, including the selective `/core` factory, provide both instance methods.
Instance methods accept collection limits as their second argument.

```typescript
import { parseDocument } from '@lpm.dev/neo.markdown/sanitized'

const result = parseDocument(userInput, {
  allowHtml: true,
  sanitize: true,
}, {
  maxDiagnostics: 100,
})
```

## Stylesheet assets

Built-in highlighting, presentation, and copy-code plugins return CSS assets separately for structured calls.
They collect assets only as their renderers or transforms use them.
A document without relevant content does not receive those assets.
The plugins omit their generated `<style>` elements from structured HTML.

The `injectStyles` option continues to control string output. Structured calls collect available assets even with `injectStyles: false`.
Raw HTML styles, custom HTML transforms, and embed style attributes remain in the HTML.
The result does not fetch third-party embed assets.

Each asset has an `id` and a CSS string. Equal IDs with equal CSS deduplicate within the call.
Different CSS for the same ID throws an error. Asset order follows first collection.
An asset ID identifies CSS configuration. It is not a content hash or a URL.

| Built-in asset | ID |
| --- | --- |
| Highlight theme | `neo.highlight:<syntax-prefix>` |
| Code presentation | `neo.markdown:code-presentation:<presentation-prefix>` |
| Copy controls | `neo.markdown:copy-code:<wrapper-class>:<button-class>` |

Stylesheets are trusted CSS from plugin configuration. HTML sanitization does not sanitize CSS assets.
For external CSS, write the returned CSS to an application-owned stylesheet asset.
For DOM insertion, assign CSS through a style element's `textContent`.
Avoid concatenating custom CSS into raw `<style>` markup.

### Syntax highlighting

```typescript
import { createParser } from '@lpm.dev/neo.markdown/sanitized'
import { codePresentationPlugin } from '@lpm.dev/neo.markdown/plugins/code-presentation'
import { tokenize, renderToHTML, getThemeStylesheet } from '@lpm.dev/neo.highlight'
import { javascript } from '@lpm.dev/neo.highlight/grammars/javascript'
import { githubDark } from '@lpm.dev/neo.highlight/themes/github-dark'

const parser = createParser({
  allowHtml: true,
  sanitize: true,
  plugins: [codePresentationPlugin({
    highlight: {
      grammars: [javascript], tokenize, renderToHTML, getThemeStylesheet,
      theme: githubDark, styleMode: 'class', errorPolicy: 'plain',
    },
  })],
})

const result = parser.parseDocument(markdown)
```

The highlighting plugin needs `getThemeStylesheet` and a theme to supply the theme asset.
If a theme uses class output without that helper, the plugin reports `stylesheet-unavailable`.
An application can also supply the theme CSS separately.
Class output avoids inline syntax styles and works with the built-in HTML sanitizer.
Plain recovery returns presentation CSS without an unused syntax theme asset.

## Diagnostics

Each diagnostic contains `source`, `code`, `severity`, and `message`.
Optional fields provide an authoring field, a code-block location, or a metadata range.
Messages, languages, and field names are plain text. Applications must escape them for HTML display.

```typescript
for (const diagnostic of result.diagnostics) {
  console.log(diagnostic.codeBlock?.index, diagnostic.field, diagnostic.message)
}
```

| Source | Codes | Meaning |
| --- | --- | --- |
| `code-metadata` | `invalid-syntax`, `duplicate-key`, `limit-exceeded` | Feedback from the fence metadata parser |
| `code-presentation` | `invalid-field` | Invalid presentation metadata, including word ranges |
| `highlight` | `unknown-language` | No registered grammar matches the language hint |
| `highlight` | `highlight-failed` | Configuration, tokenization, or rendering failed under plain recovery |
| `highlight` | `stylesheet-unavailable` | The configured class theme has no stylesheet helper |

Built-in recoverable diagnostics use severity `warning`. Custom plugins can also report severity `error`.
The severity field describes a diagnostic. It does not change control flow.
The highlighting `onError` and presentation `onDiagnostic` callbacks retain their existing behavior.

Code-block indexes start at one and follow render order, including blocks inside lists and blockquotes.
They are not document line numbers. The language uses the normalized fence spelling, before grammar alias resolution.
`metaRange` uses zero-based UTF-16 offsets into raw fence metadata, with an exclusive end.
The parser does not provide absolute Markdown source positions in this result.

Strict highlighting failures, callback errors, sanitizer errors, and resource-limit errors still throw.
A failed call does not return a partial document. Collection errors do not become plain highlighting fallbacks.
These diagnostics describe configured plugins. They are not a complete Markdown linter or a sanitizer removal log.

## TOC data

`tocPlugin()` supplies entries for the headings that its renderer emits.
Entries contain a heading level, plain text, and the generated ID.
Heading depth filters, duplicate slugs, inline text extraction, and anchor behavior retain their existing rules.
The legacy `onToc` callback remains available. Structured consumers can read `result.toc` directly.

Without the TOC plugin, the array is empty. Each call starts with fresh heading IDs and entries.
Later custom HTML transforms can change headings or IDs. Such transforms must preserve their own correspondence with TOC data.

## Custom plugin contributions

`builder.document` exposes the active collection context during a structured call.
It is undefined during plugin setup and string calls.
Plugins can add assets, diagnostics, and TOC entries during tokenization, transforms, or rendering.

```typescript
import type { MarkdownPlugin } from '@lpm.dev/neo.markdown'

const noticePlugin: MarkdownPlugin = builder => {
  builder.addHtmlTransform(html => {
    if (builder.document) {
      builder.document.addStylesheet({ id: 'notice', css: '.notice{color:blue}' })
      builder.document.reportDiagnostic({
        source: 'notice', code: 'example', severity: 'warning',
        message: 'Example diagnostic',
      })
    }
    return html
  })
}
```

`reportDiagnostic()` automatically attaches the active code-block location unless the plugin supplies one.
Contributions receive defensive snapshots. Later changes to caller objects do not change a result.
Nested structured calls receive separate contexts. Nested string calls suspend collection until the outer call resumes.
Retained contexts reject writes after their call finishes or throws.
Plugin callbacks remain trusted synchronous code and must manage any independent mutable state they retain.

## Limits and rendering order

| Document option | Default | Applies to |
| --- | ---: | --- |
| `maxStylesheets` | 64 | Distinct stylesheet IDs |
| `maxStylesheetLength` | 1,000,000 | Combined CSS length in UTF-16 units |
| `maxDiagnostics` | 1,000 | Diagnostic entries |
| `maxTocEntries` | 10,000 | TOC entries |

Limits accept non-negative safe integers or `Infinity`. Exceeding a limit throws without silently truncating the result.
The parser, UGC mode, highlighter, and presentation plugin retain their separate limits.

Structured methods use the same token transforms, renderer, sanitizer, and HTML transforms as string methods.
Code-block hooks still run before sanitization. Trusted HTML transforms still run after sanitization.
CSS and TOC collection add work only for structured calls. Parser reuse does not retain results from earlier calls.

The result contains no browser initialization state. Copy controls and embeds still require their explicit client initializers.
React consumers can render returned stylesheet assets beside the HTML and use `result.toc` for navigation.
Identical input and deterministic plugins produce identical server and client results.
