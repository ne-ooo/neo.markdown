---
name: getting-started
description: How to use @lpm.dev/neo.markdown — parse(), createParser(), plugin system (highlight, embeds, TOC, copy-code), PluginBuilder API, custom block/inline rules, renderer overrides, token transforms, CodeToken.meta, directive syntax, sub-path exports, sanitization, ugc, safeLinks, blocks
version: "3.0.0"
globs:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.js"
  - "**/*.jsx"
---

# Getting Started with @lpm.dev/neo.markdown

Version 3 requires Node.js 22.12 or later. The existing string API remains available.
Nonempty parsed code tokens retain their final newline.

## Quick Start

Convert markdown to HTML:

```typescript
import { parse } from '@lpm.dev/neo.markdown'

const html = parse('# Hello World\n\nThis is **bold** and *italic*.')
```

An optionless `parse()` call reuses one lazy parser. If you pass options, `parse()` creates a new parser. For repeated parsing with the same options, use `createParser()`:

```typescript
import { createParser } from '@lpm.dev/neo.markdown'

const parser = createParser()
const html1 = parser.parse(doc1)
const html2 = parser.parse(doc2)
```

## Options

```typescript
interface ParserOptions {
  allowHtml?: boolean         // Allow raw HTML in output (default: false)
  gfm?: boolean               // Enable GFM tables, strikethrough, autolinks (default: false)
  breaks?: boolean             // Convert bare \n to <br> (default: false)
  sanitize?: boolean           // Sanitize HTML when allowHtml is true (default: false)
  sanitizer?: HtmlSanitizer    // Custom sanitizer provider
  allowedTags?: string[]       // Extend default allowed tags (requires sanitize: true)
  allowedAttributes?: Record<string, string[]>  // Per-tag allowed attributes
  allowStyle?: boolean         // Allow restricted style properties in sanitized HTML (default: false)
  safeLinks?: boolean | SafeLinkOptions  // External link rel/target, baseUrl resolution
  ugc?: boolean                // Shorthand for safe user-generated content rendering
  maxInputLength?: number      // Maximum input length in UTF-16 code units
  lazyImages?: boolean         // Add loading="lazy" to images (default: true)
  blocks?: BlockRule[]         // Selective block rules for tree-shaking
  plugins?: MarkdownPlugin[]   // Plugins to extend the parser
}
```

## Sanitization

Import the `/sanitized` entry to use the built-in structural sanitizer:

```typescript
import { parse } from '@lpm.dev/neo.markdown/sanitized'

const html = parse(userInput, {
  allowHtml: true,
  sanitize: true,
})
```

`allowedTags` extends the defaults (it does not replace them). `allowedAttributes` is a per-tag record:

```typescript
const html = parse(userInput, {
  allowHtml: true,
  sanitize: true,
  allowedTags: ['details', 'summary'],
  allowedAttributes: { a: ['href', 'title'], img: ['src', 'alt'] },
})
```

Set `allowStyle: true` to permit these properties:

- `color`
- `background-color`
- `font-style`
- `font-weight`
- `text-align`
- `text-decoration`
- `white-space`

The sanitizer removes layout properties, CSS expressions, and URL values.

## Safe Links

`safeLinks` adds `rel="noopener noreferrer"` and `target="_blank"` to external links, and resolves relative URLs against a `baseUrl`:

```typescript
const html = parse(readme, { safeLinks: true })

// With baseUrl for relative link resolution
const html = parse(readme, {
  safeLinks: { baseUrl: 'https://github.com/org/repo/blob/main/' },
})
```

## User-Generated Content (UGC)

`ugc: true` enables safe defaults for untrusted content. It enables `safeLinks`, disables raw HTML, and limits the input size:

```typescript
const html = parse(commentBody, { ugc: true })
```

UGC mode limits input to 1,000,000 UTF-16 code units. Use `maxInputLength` to set a smaller limit.

## Lazy Images

Images get `loading="lazy"` by default. Disable with `lazyImages: false`:

```typescript
const html = parse(md, { lazyImages: false })
```

## Selective Block Loading

Import individual block rules from `@lpm.dev/neo.markdown/blocks` and pass them via the `blocks` option. Unused rules are tree-shaken out of the bundle:

```typescript
import { createParser } from '@lpm.dev/neo.markdown/core'
import { heading, paragraph, code, list, blockquote } from '@lpm.dev/neo.markdown/blocks'

const parser = createParser({
  blocks: [heading, paragraph, code, list, blockquote],
})
```

The `/core` factory requires an explicit `blocks` array. Import from the main package when you want all default rules. Passing `blocks` to the main factory changes behavior but does not reduce the main entry bundle.

## Plugin System

Parsed code tokens retain their final newline in `text`. Renderer callbacks, highlighting, diagnostics, and copy controls receive the same source.
The `meta` field retains raw fence metadata. The `lang` field decodes Markdown escapes and character references.

Plugins extend the parser with custom tokenization, rendering, and transforms. A plugin is a plain function:

```typescript
import { createParser } from '@lpm.dev/neo.markdown'
import { tocPlugin } from '@lpm.dev/neo.markdown/plugins/toc'
import { embedPlugin } from '@lpm.dev/neo.markdown/plugins/embeds'
import { copyCodePlugin } from '@lpm.dev/neo.markdown/plugins/copy-code'

const parser = createParser({
  gfm: true,
  plugins: [
    tocPlugin({ maxDepth: 3 }),
    embedPlugin({ youtube: true, twitter: true }),
    copyCodePlugin(),
  ]
})
```

### Highlight Plugin

Syntax highlighting via `@lpm.dev/neo.highlight`. Pass the functions directly:

```typescript
import { highlightPlugin } from '@lpm.dev/neo.markdown/plugins/highlight'
import { tokenize, renderToHTML, getThemeStylesheet } from '@lpm.dev/neo.highlight'
import { javascript, typescript, python } from '@lpm.dev/neo.highlight/grammars'
import { githubDark } from '@lpm.dev/neo.highlight/themes/github-dark'

highlightPlugin({
  grammars: [javascript, typescript, python],
  tokenize,
  renderToHTML,
  getThemeStylesheet, // generates CSS mapping .neo-hl-keyword → var(--neo-hl-keyword)
  theme: githubDark,
  lineNumbers: true,
  errorPolicy: 'plain',
  maxInputLength: 100_000,
  onError: (error, context) => console.error(context.language, error),
})
```

Language hints and registered aliases ignore case and surrounding whitespace.
The default `errorPolicy: 'throw'` preserves strict errors. With `'plain'`, a failed block becomes escaped source and the rest of the document renders.
The callback receives `{ stage, code, language, meta }`. Its own errors propagate.

Limits are `maxInputLength`, `maxMatchCount`, `maxTokenCount`, `maxTokenDepth`, `maxRenderedLength`, and `maxLines`.
They apply to highlighting. The plain fallback retains the complete code token, so also set the parser's input limit for untrusted documents.

Use `diffHighlight: { added: [1], removed: [2] }` for fixed diff lines.
A `diffHighlight(token)` callback can select different lines for each code block.

For React, set `injectStyles: false` in the highlight plugin. Generate the theme CSS separately and include it through the layout:

```tsx
const themeCSS = getThemeStylesheet(githubDark)
// Render as: <style>{themeCSS}</style>
```

With `allowHtml: true` and `sanitize: true`, inline highlight styles are removed but token classes remain.
The external stylesheet is required for theme colors and line styles in that configuration.
Keep the sanitizer's CSS restrictions active. `injectStyles` controls stylesheet insertion, not inline token attributes.

Code block meta strings are parsed: `` ```ts {1,3-5} `` → `lang: "ts"`, `meta: "{1,3-5}"`.

### Embed Plugin

YouTube, Vimeo, Twitter/X, CodeSandbox, CodePen, GitHub Gist, and Loom embeds via directive syntax:

```typescript
import {
  embedPlugin,
  initializeEmbeds,
} from '@lpm.dev/neo.markdown/plugins/embeds'

embedPlugin({
  youtube: { privacyEnhanced: true },
  vimeo: true,
  twitter: true,
  codesandbox: true,
  codepen: true,
  gist: true,
  loom: true,
  autoEmbed: true, // bare URLs in paragraphs become embeds
  consent: true,   // GDPR consent mode — shows placeholder until user opts in
})

// After the rendered HTML mounts, run this.
const cleanup = initializeEmbeds()
```

The initializer handles consent clicks, Gist frames, and Twitter widgets. When the rendered root unmounts, run `cleanup()`.

Directive syntax in markdown:

```markdown
::youtube[dQw4w9WgXcQ]
::vimeo[361905857]
::tweet[2034382182353871105]
::codesandbox[abc123]
::codepen[xyz]{user="username"}
::gist[abc123def]{user="username"}
::loom[share_id]
```

#### React Embed Components

Pre-built React components for embeds. Vimeo and Tweet defer content with IntersectionObserver. The iframe-based components use native `loading="lazy"`. GitHub Gist embeds use the HTML plugin and `initializeEmbeds()` above:

```tsx
import { YouTube, Vimeo, Tweet, CodeSandbox, CodePen, Loom } from '@lpm.dev/neo.markdown/plugins/embeds/react'

<YouTube id="dQw4w9WgXcQ" privacyEnhanced />
<Vimeo id="361905857" />
<Tweet id="2034382182353871105" />
<CodeSandbox id="abc123" />
<Loom id="share_id" />
```

### TOC Plugin

Heading anchors + table of contents extraction:

```typescript
import { tocPlugin } from '@lpm.dev/neo.markdown/plugins/toc'
import type { TocEntry } from '@lpm.dev/neo.markdown/plugins/toc'

let toc: TocEntry[] = []

tocPlugin({
  maxDepth: 3,
  minDepth: 1,
  anchorLinks: true,
  anchorClass: 'anchor',
  onToc: (entries) => { toc = entries },
})
// toc = [{ level: 1, text: 'Title', id: 'title' }, ...]
```

Produces: `<h1 id="title"><a class="anchor" href="#title">Title</a></h1>`

### Copy-Code Plugin

Injects an inert copy button into `<pre>` blocks. It does not emit inline scripts. Call the explicit initializer once from client code:

```typescript
import {
  copyCodePlugin,
  getCopyCodeStyles,
  initializeCopyCode,
} from '@lpm.dev/neo.markdown/plugins/copy-code'

copyCodePlugin({
  buttonText: 'Copy',       // Text shown on the button (default: 'Copy')
  copiedText: 'Copied!',    // Text shown after copying (default: 'Copied!')
  buttonClass: 'copy-code-button',
  injectStyles: true,        // Inject default CSS for hover-to-reveal (default: true)
})

const cleanup = initializeCopyCode()
```

Set `injectStyles: false` for a strict style CSP. Use `getCopyCodeStyles()` to write the default CSS to an external stylesheet. Class names are validated as single CSS identifiers, and all labels are HTML-escaped.

See [authoring and plugins](./authoring-and-plugins.md) for the remaining APIs.

## Incremental documents

Import `createIncrementalMarkdown` from `@lpm.dev/neo.markdown/incremental` for repeated document updates.
The `update` and `append` methods return structured document results.
The session resumes built-in block parsing from checkpoints with dependency ranges and reuses unchanged blocks.
Reference changes invalidate only affected inline cache entries, including unresolved links.
Open fences, tables, lists, and blockquotes continue from safe cursors, including nested child blocks.
Earlier dependency changes restart the affected block. Rendering still processes the complete document on every update.
Plugins disable reuse by default. Custom blocks and caller renderer overrides always disable reuse.
For eligible render plugins, wrap each plugin with `defineIncrementalPlugin()` and set `pluginReuse: "declared"`.
Pure inline plugins also require `effects: "none"` and explicit static or revision dependencies.
Normal sanitization and UGC limits still apply.
Dispose the session after use. Read `docs/incremental.md` for cache and cumulative work limits.


For editor ownership, use `createMarkdownApplication()` from `@lpm.dev/neo.markdown/application`.
For React, use `useMarkdownDocument()` from `@lpm.dev/neo.markdown/application/react` with stable options.
Read `docs/application-adapter.md` for worker selection, lazy fallbacks, cancellation, and recovery.
Stable entry paths and legacy aliases follow `docs/api-stability.md`.
