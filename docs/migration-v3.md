# Migration to version 3

Upgrade Node.js to 22.12 or later before installing this version.
The package requires this runtime for sanitize-html 2.17.7 and its HTML parser dependency.
The runtime requirement applies to ESM and CommonJS consumers of the package.
Browser builds still support selective parser imports and the separate sanitizer entry.

## Existing applications

The existing `parse()` and `render()` methods still return strings.
The new `parseDocument()` and `renderDocument()` methods return HTML, stylesheet assets, diagnostics, and TOC data.
All existing package entry points remain available.

Nonempty parsed code blocks now retain their final newline in `CodeToken.text`.
Renderer callbacks, highlighting, diagnostics, and copy controls receive that newline.
Update snapshots or callbacks that previously assumed its absence.

Corrected lists, emphasis, references, entities, and HTML boundaries can change rendered HTML and token trees.
Run application tests after the upgrade.
CommonMark coverage is 648 of 652 exact matches, with four explicit URL-policy differences.
GFM checks cover selected extension fixtures and do not establish full conformance.
See [compatibility and limits](./compatibility.md).

Explicit `HighlightOptions` type annotations now take grammar, token, and theme type parameters.
Direct plugin calls infer these types.
The release integration suite uses neo.highlight 1.4.0.

## Sanitized output

The built-in sanitizer remains available through `@lpm.dev/neo.markdown/sanitized`.
The main and core entries still require a custom sanitizer when sanitization is active.
The upgrade retains the existing tag, attribute, URL, and CSS restrictions.
The `xmp` restriction remains active.
The dependency update fixes GHSA-jxwj-j7wr-gfrw and GHSA-g8qq-57p8-ggw5 upstream.

Use class highlighting with external stylesheets for sanitized code blocks.
Structured results collect used stylesheets without automatic browser insertion.
See [document results](./document-results.md) and [code presentation](./code-presentation.md).

## Stable document ownership

Version 3.0 adds stable `incremental`, `dom`, `worker`, and `worker-client` entries.
The corresponding experimental paths remain aliases to the same runtime files. Existing imports continue to work.
The `application`, `application/sync`, and `application/react` entries add reusable document ownership and a React hook.
See [application ownership](./application-adapter.md) and [API stability](./api-stability.md) for lifecycle and compatibility rules.
