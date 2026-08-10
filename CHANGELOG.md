# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Security

- Inline formatting now has a hard nesting limit, which prevents stack exhaustion on small crafted inputs.
- `render()` rejects malformed, cyclic, and over-depth runtime token graphs before HTML generation.
- The sanitizer removes reserved embed activation markers from user HTML while preserving trusted plugin embeds.
- Safe-link handling classifies browser-special slash and backslash authorities as external.
- CodeSandbox embeds use a reduced iframe capability policy by default.

### Performance

- Emphasis, deletion, code-span, and inline-HTML parsing now use linear delimiter and terminator indexes.
- TOC and copy-code transforms avoid whole-suffix regular-expression rescans.
- Repeated invalid inline syntax is coalesced into bounded text-token counts.
- Safe-link base URLs and structural sanitizer options are compiled once per parser.
- React Tweet embeds share one readiness poll, and eager Vimeo embeds skip intersection observers.
- Adversarial scaling tests cover every fixed denial-of-service input with hard process timeouts.

### Added

- Exported `escapeHtml()` for safe custom renderer output.

## [2.0.0] - 2026-08-10

### Security

- The `render()` method rejects raw HTML tokens when `allowHtml` is `false`.
- UGC mode limits Markdown input to 1,000,000 UTF-16 code units.
- The `maxInputLength` option sets a smaller limit for any parser.
- Embed consent output no longer contains inline event handlers.
- Consent payloads describe known providers and cannot inject arbitrary HTML.
- `allowStyle: true` permits only non-layout properties with restricted values.

### Performance

- Link parsing now scans brackets and destinations in linear time.
- Optionless `parse()` calls reuse one lazy parser in the main, sanitized, CommonMark, and GFM entries.
- Table detection avoids backtracking on long pipe-heavy lines.
- The main and `/core` entries no longer load `sanitize-html`.
- The bundle gate now includes all production dependencies in its measurements.

### Added

- The `/sanitized` entry provides the built-in structural HTML sanitizer.
- The `sanitizer` option accepts a custom sanitizer provider.
- CommonMark URI and email angle autolinks now parse before raw HTML.
- The `initializeEmbeds()` client initializer activates consent, Gist, and Twitter output.
- GitHub Actions tests Node.js 18 and 26 with a frozen LPM lockfile and a vulnerability gate.
- CommonMark tests lock the exact passing example numbers.
- React embed tests cover lazy loading, script reuse, and cleanup.
- Adversarial scaling tests run in child processes with hard execution limits.

### Changed

- Import from `/sanitized` to use `allowHtml: true` with `sanitize: true`.
- The package version is now `2.0.0` because the current API changes require a major release.
- Gist output stays inert until `initializeEmbeds()` creates an isolated frame.
- Development builds use esbuild 0.28.2, including the version used by tsup.
- The sanitized entry pins `sanitize-html` 2.17.5 for Node.js 18 compatibility.

### Fixed

- Code spans now apply the CommonMark rules for spaces and line endings.
- Link destinations stop at their matching parenthesis instead of consuming later text.
- Auto-embed matching now parses complete URLs and checks exact provider hostnames and paths.

## [1.2.1] - 2026-03-22

### Fixed

- **Sanitizer runs before plugin HTML transforms** — Plugins like copy-code inject trusted HTML (`<script>`, `<button>`) that must not be stripped. Sanitization now processes user-provided HTML first, then plugins apply their transforms after

### Changed

- **Copy-code plugin rewritten** — Now includes inline `<script>` for click-to-copy (no external JS needed), default CSS styles with hover-to-reveal, `copiedText` option for feedback text, `injectStyles` option, and proper handling of `<pre>` tags with attributes (e.g., from highlight plugin)

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
