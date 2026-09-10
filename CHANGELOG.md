# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [3.0.0] - Unreleased

- Update Vitest to 4.1.11 for GHSA-82fw-gwwq-j7x9. Adversarial subprocess checks retain their two-second limit.

- Pass source-preserving line layout through highlight options and retain exact copy output for source-line spans.

### Application adapter and stable document APIs

- Add framework-neutral document ownership through `application` and a React hook through `application/react`.
- Add `application/sync` for bounded synchronous fallbacks, including session rotation and cleanup.
- Coalesce pending source during asynchronous fallback setup and dispose abandoned sessions.
- Add stable `incremental`, `dom`, `worker`, and `worker-client` imports with identical legacy alias runtimes.
- Record public declarations in an ESM/CommonJS compatibility snapshot.
- Keep existing string and document APIs compatible.

See [application ownership](./docs/application-adapter.md) and [API stability](./docs/api-stability.md).

### Markdown workers

- Add optional worker handler and client entries for complete document updates.
- Keep parser configuration, plugins, highlighting, and sanitization inside one dedicated worker per document.
- Coalesce edits with one active request and one queued revision while retaining incremental parser state.
- Add cancellation, deadlines, stale-result rejection, finite transport limits, session rotation, and idle cleanup.
- Preserve structured results and plugin declarations across the worker boundary.
- Document application ownership and recovery without automatic callback retries.

See [worker sessions](./docs/worker-sessions.md) for configuration and limits.

### Incremental documents

- Added the optional `experimental` entry for repeated structured document updates.
- Resume built-in block parsing from checkpoints with dependency ranges and reuse unchanged prefixes and suffixes.
- Track lookahead for references, lists, tables, fences, and other built-in blocks.
- Invalidate inline cache entries by their resolved and unresolved reference dependencies.
- Bound block and inline caches while preserving structural and inline UGC token budgets.
- Continue open fences, tables, lists, and blockquotes from safe cursors, including nested child blocks.
- Track continuation work and include saved state in cache limits.
- Retain complete rendering on every update. Earlier dependency changes restart the affected block.
- Added `defineIncrementalPlugin()` and opt-in reuse for declared render plugins, including highlight, presentation, copy-code, and TOC.
- Check actual registrations and report bounded fallback reasons through `session.reuse`.
- Isolate cached tokens before callbacks and charge copy work to the session budget.
- Reject late registration and reentrant updates after declared setup succeeds.
- Keep complete parsing for undeclared plugins, custom blocks, caller renderer overrides, and registration mismatches.
- Keep `pluginReuse: "off"` as the default and run all render callbacks on every update.
- Enable pure inline declarations with static dependencies or bounded revision getters.
- Clear inline caches on revision changes while retaining built-in block checkpoints.
- Guard rendering and document services during inline tokenization and revision sampling.
- Snapshot rule metadata and custom token graphs without calling property getters. Unsupported graphs remain uncached.
- Track revision transitions through `pluginInvalidations` and bound snapshot metadata and copy work.
- Add `IncrementalMarkdownLimitError` for session limit classification, with existing `RangeError` compatibility and unchanged messages.
- Document application session ownership, cancellation, hydration, and recovery without automatic retries.

See [incremental documents](./docs/incremental.md) for API behavior and limits.

### DOM patches

- Retain syntax indexes across container changes with the optional `maxCodeBlockHtmlLength` cache.
- Reuse code nodes across multiple blocks, reordering, and changed parent containers within complete-document limits.
- Stage changed syntax and surrounding markup separately, with validation before live mutation and recovery after external changes.
- Reuse canonical validation for unchanged regions while counting duplicates toward the node limit.
- Reduce DOM attribute allocations and repeated ownership walks during nested patches.
- Patch ordinary descendants inside changed code blocks, presentation figures, lists, tables, and containers.
- Add explicit lifecycle update hooks for initialized scopes and `patchChildren: false` to disable ordinary descendant patches.
- Add copy-controller refresh to reset stale feedback after edits and ignore late completions from previous scope revisions.
- Bound nested snapshots with existing limits and expose `cachedNodes` and optional `patchedRegions` counters.
- Add the separate `experimental/dom` entry with `createMarkdownView()` for bounded top-level region matching.
- Preserve unchanged DOM regions and their control state, with cleanup before changed regions are removed.
- Use complete replacement for unsupported HTML or exceeded patch limits, without retaining patch snapshots.
- Close the view after lifecycle errors without automatic retries.
- Support root embed scopes and remove their pending Twitter-load listeners during cleanup.

See [DOM patches](./docs/dom-patches.md) for ownership, limits, and application integration.

### Breaking changes

- Require Node.js 22.12 or later, including CommonJS consumers.
- Upgrade sanitize-html to 2.17.7, which fixes GHSA-jxwj-j7wr-gfrw and GHSA-g8qq-57p8-ggw5.
- Keep the string-returning API and all existing package entry points.

See [migration to version 3](./docs/migration-v3.md) before upgrading.

### Structured document results

- Added `parseDocument()` and `renderDocument()` with immutable HTML, stylesheet, diagnostic, and TOC results.
- Added used stylesheet assets, metadata and highlighting diagnostics, and direct TOC data from built-in plugins.
- Added bounded collection services for custom plugins and isolated state for nested calls.
- Preserved string output, plugin callbacks, sanitization order, and strict errors.

See [document results](./docs/document-results.md) for entry points, asset handling, diagnostics, and limits.

### Code blocks

- Added `mark` metadata for word selections with one-based lines and Unicode code-point columns.
- Added plain, highlighted, sanitized, and fallback selections that preserve focus, diff notation, and clean copy output.
- Added global and per-block UTF-16 ranges to the highlighting plugin.

See [word highlighting](./docs/word-highlighting.md) for syntax, range limits, and precedence.

- Added a reusable presentation plugin for captions, filenames, focus ranges, and explicit diff prefixes.
- Added plain and highlighted presentation, external styles, keyboard access, and copy output that excludes removed lines.
- Kept source tokens unchanged and bounded the complete presentation output.

See [code presentation](./docs/code-presentation.md) for syntax and integration.

- Added exact fence info, immutable render contexts, and bounded metadata parsing helpers.
- Added composable parser and plugin hooks around the final code renderer, before sanitization.
- Added per-block highlighting options, token/line/wrapper decorators, and displayed line offsets.
- Kept metadata parsing outside default and selective parser bundles.
- Added consumer, sanitizer, copy, and demo checks for these APIs.

See [code-block APIs](./docs/code-blocks.md) for syntax, hook order, and limits.

### Added

- The highlight plugin forwards `styleMode: "class"` for output with a shared stylesheet.
- `lpm run bench:efficiency` measures startup, heap, and output for representative Markdown fixtures.

- Per-example checks for all 652 CommonMark 0.31.2 fixtures in the main and CommonMark entries.
- Explicit expected output for the four autolinks that the URL policy blocks.
- Named character references from WHATWG and additional adversarial checks for the new parser paths.
- Typed highlighting limits, per-block diff options, and error diagnostics.
- Explicit `HighlightOptions` annotations now use grammar, token, and theme type parameters. Direct plugin calls infer these types.
- `errorPolicy: "plain"` preserves escaped source when highlighting fails. The default remains `"throw"`.
- `injectStyles: false` supports a separate theme stylesheet in Markdown integrations.
- Built-package integration tests cover ESM, CommonJS, strict TypeScript, sanitization, and browser initializers.
- Copy-code initialization accepts an `onError` callback for clipboard failures.

### Fixed

- GFM tables accept continuation rows without pipes and omit empty table bodies.
- GFM strikethrough supports one or two tildes and rejects longer delimiter runs.
- GFM email autolinks preserve explicit Markdown link destinations. The default renderer applies the GFM raw HTML tag filter.
- Added all 28 normative GFM extension examples, with explicit expectations for the three XMPP URL-policy differences.
- Preserved all 648 CommonMark matches and the four existing CommonMark URL restrictions.

- Plain inline text avoids link indexes, and inputs without emphasis avoid delimiter-list allocation.

- CommonMark compatibility increases from the corrected 314-example baseline to 648 matching examples, without baseline regressions.
- The fixture harness expands the specification's visible tab markers before parsing and comparison.
- Tabs use four-column indentation. Fenced and indented code retain content boundaries and final newlines.
- Lists preserve marker changes, continuation indentation, empty items, nesting, and tight versus loose rendering.
- Blockquotes support lazy paragraph continuation. Setext headings support multiple lines.
- Emphasis uses delimiter runs, Unicode flanking rules, and the rule of three.
- Links and references support nested labels, multiline definitions, decoded destinations, titles, and image descriptions.
- HTML blocks follow their distinct termination rules. Inline HTML requires valid tag syntax.
- Entity decoding preserves the HTML and URL security policies.
- Language names and aliases use the same normalization as neo.highlight.
- Tabs separate fenced-code language identifiers from metadata.
- Highlight metadata counts CRLF and bare CR lines in caller-provided tokens.
- Copy buttons preserve highlighted line breaks and omit line numbers and diff markers.
- Copy cleanup removes label timers and ignores pending clipboard results.
- The structural sanitizer always rejects `xmp`, including custom allowlists, to mitigate GHSA-jxwj-j7wr-gfrw.

### Compatibility notes

- `CodeToken.text` now includes the final newline for nonempty parsed code blocks. Renderer callbacks, diagnostics, highlighting, and copy controls receive it.
- Corrected emphasis nesting, list structure, URL encoding, and image descriptions can change rendered output and token trees.
- Raw fence metadata remains available in `CodeToken.meta`. The language identifier receives Markdown escape and entity decoding.
- See [compatibility and limits](./docs/compatibility.md) for intentional URL restrictions and coverage.

## [2.0.0] - 2026-08-25

### Security

- The `render()` method rejects raw HTML tokens when `allowHtml` is `false`.
- UGC mode limits Markdown input to 1,000,000 UTF-16 code units.
- The `maxInputLength` option sets a smaller limit for any parser.
- Embed consent output no longer contains inline event handlers.
- Consent payloads describe known providers and cannot inject arbitrary HTML.
- `allowStyle: true` permits only non-layout properties with restricted values.
- Inline formatting now has a hard nesting limit, which prevents stack exhaustion on small crafted inputs.
- `render()` rejects malformed, cyclic, and over-depth runtime token graphs before HTML generation.
- The sanitizer removes reserved embed activation markers from user HTML while preserving trusted plugin embeds.
- Sanitized links that open a new browsing context enforce `noopener noreferrer` and remove `opener`.
- Safe-link handling classifies browser-special slash and backslash authorities as external.
- CodeSandbox embeds use a reduced iframe capability policy by default.
- CodePen embeds use a least-privilege iframe sandbox.

### Performance

- Link parsing now scans brackets and destinations in linear time.
- Optionless `parse()` calls reuse one lazy parser in the main, sanitized, CommonMark, and GFM entries.
- Table detection avoids backtracking on long pipe-heavy lines.
- The main and `/core` entries no longer load `sanitize-html`.
- The bundle gate now includes all production dependencies in its measurements.
- Emphasis, deletion, code-span, and inline-HTML parsing now use linear delimiter and terminator indexes.
- TOC and copy-code transforms avoid whole-suffix regular-expression rescans.
- Repeated invalid inline syntax is coalesced into bounded text-token counts.
- Safe-link base URLs and structural sanitizer options are compiled once per parser.
- React Tweet embeds share one readiness poll, and eager Vimeo embeds skip intersection observers.
- Adversarial scaling tests cover every fixed denial-of-service input with hard process timeouts.

### Added

- The `/sanitized` entry provides the built-in structural HTML sanitizer.
- The `sanitizer` option accepts a custom sanitizer provider.
- CommonMark URI and email angle autolinks now parse before raw HTML.
- The `initializeEmbeds()` client initializer activates consent, Gist, and Twitter output.
- GitHub Actions tests Node.js 18 and 26 with a frozen LPM lockfile and a vulnerability gate.
- CommonMark tests lock the exact passing example numbers.
- React embed tests cover lazy loading, script reuse, and cleanup.
- Adversarial scaling tests run in child processes with hard execution limits.
- Exported `escapeHtml()` for safe custom renderer output.

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
