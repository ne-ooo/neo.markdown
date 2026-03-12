# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

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
