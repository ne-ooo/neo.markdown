# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [1.1.0] - 2026-03-21

### Added

- **Plugin system** — Extend the parser with `plugins: [...]` option. Plugins are plain functions `(builder) => void` with a clean builder API
- **PluginBuilder API** — `addBlockRule()`, `addInlineRule()`, `setRenderer()`, `addTokenTransform()`, `addHtmlTransform()`, `renderInline()`, `renderBlock()`
- **Block rules** — Custom block-level tokenization with numeric priority or positional constraints (`before:paragraph`, `after:code`)
- **Inline rules** — Custom inline tokenization with `triggerChars` for char-code fast-path optimization
- **Highlight plugin** (`@lpm.dev/neo.markdown/plugins/highlight`) — Syntax highlighting via `@lpm.dev/neo.highlight`. Pass `tokenize`, `renderToHTML`, `getThemeStylesheet` directly
- **Embed plugin** (`@lpm.dev/neo.markdown/plugins/embeds`) — YouTube, Vimeo, Twitter/X embeds via directive syntax (`::youtube[id]`, `::vimeo[id]`, `::tweet[id]`)
- **TOC plugin** (`@lpm.dev/neo.markdown/plugins/toc`) — Heading anchors with slugified IDs, anchor links, duplicate heading support, `onToc` callback for TOC extraction
- **Copy-code plugin** (`@lpm.dev/neo.markdown/plugins/copy-code`) — Copy-to-clipboard button on `<pre>` code blocks
- **Directive token type** — New `DirectiveToken` for custom block-level content
- **`CodeToken.meta`** — Fence info strings now split into `lang` and `meta`
- Sub-path exports: `/plugins/highlight`, `/plugins/embeds`, `/plugins/toc`, `/plugins/copy-code`
- 306 tests (up from 202)

### Changed

- **Tokenizer refactored** — Hardcoded chain converted to ordered rule array with priorities
- **Inline tokenizer refactored** — Custom inline rules integrate into char-code fast-path
- **Renderer extended** — `directive()` method, `applyOverrides()` for plugin overrides
- **README rewritten** — Plugin docs, shipped plugins reference, PluginBuilder API, rehype migration guide

## [0.1.0] - 2026-03-09

### Added

- **`parse(markdown, options?)`** — Parse markdown string to HTML
- **`createParser(options?)`** — Create a reusable parser instance with `parser.parse()`
- **`HtmlRenderer`** — Customizable HTML renderer
- **Block elements** — headings, paragraphs, blockquotes, lists (ordered/unordered), code blocks, horizontal rules, tables (GFM), task lists (GFM)
- **Inline elements** — bold, italic, strikethrough, code spans, links, images, autolinks, hard line breaks
- **Presets** — CommonMark-compatible via `@lpm.dev/neo.markdown/commonmark`, GFM (GitHub Flavored Markdown) via `@lpm.dev/neo.markdown/gfm`
- **XSS protection** — HTML is escaped by default; `allowHtml: true` opt-in for trusted content
- Sub-path exports: `/core`, `/blocks`, `/inline`, `/commonmark`, `/gfm`
- Zero runtime dependencies
- ESM + CJS dual output with full TypeScript declaration files
- Source maps for debugging
- 178 tests across headings, paragraphs, emphasis, code, lists, links, tables, and more
