# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [1.2.0] - 2026-03-21

### Fixed

- **[CRITICAL] HTML sanitization now works** — `sanitize: true` with `allowHtml: true` now runs a server-side HTML sanitizer (no DOM dependency). Strips dangerous tags (`<script>`, `<iframe>`, `<style>`, etc.), event handlers (`onclick`, `onerror`), and dangerous URL protocols (`javascript:`, `data:`). Default allowlist is GitHub README-compatible
- **[CRITICAL] `renderer` option now works** — Custom renderer methods passed via `options.renderer` are applied to the `HtmlRenderer` instance. Plugin overrides take precedence over user overrides
- **[HIGH] `gfm` option now works** — Tables, strikethrough (`~~text~~`), and autolinks are now gated on `gfm: true`. When `gfm: false`, strict CommonMark parsing is used
- **[HIGH] `breaks` option now works** — When `breaks: true`, bare newlines produce `<br>` tags (GFM-style line breaks)

### Added

- **Built-in HTML sanitizer** (`src/core/sanitizer.ts`) — Server-side, regex-based, zero DOM dependencies. Works in Node.js, Deno, Bun, and edge runtimes
- **`allowedTags`** option — Extend default allowed tags when `sanitize: true` (always-blocked tags like `<script>` cannot be overridden)
- **`allowedAttributes`** option — Per-tag attribute allowlist (`Record<string, string[]>`) extending defaults
- **`allowStyle`** option — Opt-in for inline `style` attributes (default: `false`)
- **`safeLinks`** option — Add `rel="nofollow noopener noreferrer"` and `target="_blank"` to external links. Supports `baseUrl` for resolving relative links and images
- **`ugc`** shorthand — Enables `sanitize + safeLinks + allowHtml: false` in one option for safe rendering of user-generated content
- **`lazyImages`** option — Adds `loading="lazy"` to all rendered images (default: `true`)
- **`blocks`** option — Tree-shakeable block selection. Import individual rules from `@lpm.dev/neo.markdown/blocks` and pass only the ones you need
- **New embed providers** — CodeSandbox, CodePen, GitHub Gist, and Loom support in the embed plugin (directive syntax + auto-embed)
- **Production-quality embed output** — YouTube uses `youtube-nocookie.com` (privacy), Vimeo adds `?dnt=1`, Tweet adds `data-dnt="true"`. All embeds have responsive 16:9 containers, `loading="lazy"`, and accessible titles
- **GDPR consent mode** for embeds — `consent: true` renders a placeholder button instead of the iframe; clicking loads the embed
- **React embed components** (`@lpm.dev/neo.markdown/plugins/embeds/react`) — `<YouTube>`, `<Vimeo>`, `<Tweet>`, `<CodeSandbox>`, `<CodePen>`, `<Loom>` with IntersectionObserver lazy loading, script deduplication (Tweet), dark mode support
- **Highlight plugin contrast validation** — Pass `validateThemeContrast` from neo.highlight to get dev-mode warnings for WCAG AA failures
- **Unknown language warnings** — Dev-mode `console.warn` when a code block specifies an unregistered language
- **Exported sanitizer defaults** — `DEFAULT_ALLOWED_TAGS`, `DEFAULT_ALLOWED_ATTRIBUTES` available for inspection and extension
- Individual block rules exported from `@lpm.dev/neo.markdown/blocks`: `code`, `indentedCode`, `heading`, `setextHeading`, `hr`, `table`, `blockquote`, `list`, `html`, `paragraph`, `allBlockRules`
- Sub-path export: `/plugins/embeds/react`
- 471 tests (up from 306)

### Changed

- **`allowedAttributes` type** changed from `string[]` to `Record<string, string[]>` for per-tag control
- **Embed plugin** — YouTube defaults to privacy-enhanced mode (`youtube-nocookie.com`), Vimeo adds DNT, Tweet adds `data-dnt="true"`, all use responsive containers
- **`EmbedOptions`** interface expanded — `vimeo` and `twitter` accept option objects, new `codesandbox`, `codepen`, `gist`, `loom`, `consent`, `consentMessage`, `responsive` options
- React added as optional peer dependency (for embed React components only)
- `tsconfig.json` updated with `"jsx": "react-jsx"` and DOM lib

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
