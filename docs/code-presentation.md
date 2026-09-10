# Code presentation

`codePresentationPlugin()` adds captions, filenames, focus, and diff notation to code blocks.
It works with plain code and optional syntax highlighting.
The plugin has no runtime dependency on `neo.highlight`.

## Basic use

```typescript
import { createParser } from '@lpm.dev/neo.markdown'
import { codePresentationPlugin } from '@lpm.dev/neo.markdown/plugins/code-presentation'

const parser = createParser({
  plugins: [codePresentationPlugin()],
})
```

````markdown
```typescript caption="Load items" filename="src/client.ts" diff focus="2-3" lines start=20
- const endpoint = "/api/old-items";
+ const endpoint = "/api/items";
  const response = await fetch(endpoint);
  console.log(await response.json());
```
````

The figure contains a caption and a scrollable code region.
The filename is plain text. It does not create a link or read a file.
Caption and filename values receive HTML escaping.

## Metadata

| Field | Behavior |
| --- | --- |
| `caption="Load items"` | Caption text. Takes precedence over `title` |
| `title="Load items"` | Alias for the caption |
| `filename="src/client.ts"` | Filename text beside the caption |
| `lines` or `lines=true` | Display line numbers |
| `lines=false` | Disable line numbers for this block |
| `start=20` | First displayed line number |
| `focus="2,4-6"` | Focus source lines and dim the remaining lines |
| `{2,4-6}` | Highlight source lines with a background |
| `mark="2:7-2:15"` | Highlight text from line 2, column 7 up to column 15 |
| `diff` or `diff=true` | Interpret the line prefixes below |
| `diff=false` | Keep line prefixes as source text |
| `added="2-3"` | Mark added lines without removing any prefix |
| `removed="1"` | Mark removed lines and exclude them from copy-code output |
| `modified="4"` | Mark modified lines without removing any prefix |

Line ranges use one-based positions, independent of `start`.
Range expansion stops at 10,000 lines and the physical source-line count.
An invalid range applies to no lines. An out-of-range focus selection does not dim the whole block.
Invalid fields use defaults and report through the optional `onDiagnostic` callback.
Quoted values, entities, duplicate keys, and metadata limits follow the [metadata parser](./code-blocks.md).

Word selections use one-based Unicode code-point columns after diff-prefix removal. Their end positions are exclusive.
See [word highlighting](./word-highlighting.md) for multiline selections, application overrides, styles, and limits.

## Diff notation

With `diff` enabled, each line accepts one of these prefixes:

| Prefix | Meaning | Displayed source |
| --- | --- | --- |
| `+ ` | Added line | Prefix removed |
| `- ` | Removed line | Prefix removed |
| Two spaces | Unchanged context line | Prefix removed |
| Anything else | Ordinary source | Unchanged |

Prefixes require the space after the marker. Each line loses at most one prefix.
For indented context lines, the first two spaces form the prefix. Remaining indentation stays in the source.
The plugin keeps empty lines and line terminators during this transformation.
Display and copy output normalize line terminators to LF.

This notation describes code examples. It does not parse unified patch headers, hunk positions, or inline comment annotations.
Without the `diff` flag, comments, strings, operators, and line prefixes remain source text.
Metadata ranges and diff prefixes combine. Removed lines take precedence over added lines, followed by modified lines.

## Optional syntax highlighting

```typescript
import { createParser } from '@lpm.dev/neo.markdown'
import {
  codePresentationPlugin,
  getCodePresentationStyles,
} from '@lpm.dev/neo.markdown/plugins/code-presentation'
import { tokenize, renderToHTML, getThemeStylesheet } from '@lpm.dev/neo.highlight'
import { javascript } from '@lpm.dev/neo.highlight/grammars/javascript'
import { githubDark } from '@lpm.dev/neo.highlight/themes/github-dark'

const parser = createParser({
  plugins: [codePresentationPlugin({
    injectStyles: false,
    highlight: {
      grammars: [javascript], tokenize, renderToHTML,
      theme: githubDark, styleMode: 'class', injectStyles: false,
    },
  })],
})

// Serve these styles as one external asset.
const css = getCodePresentationStyles() + getThemeStylesheet(githubDark)
```

Pass the existing highlighting configuration through `highlight` instead of registering a separate `highlightPlugin()`.
Both plugins install the code renderer. With both registered, the last renderer wins.
Other block wrappers, copy controls, embeds, and document transforms remain composable.

Tokenization receives code after diff-prefix removal. Application rendering hooks receive offsets into that cleaned code.
The outer block context and caller-supplied tokens retain the original source.
Unknown languages use plain presentation with the same captions, focus, and diff behavior.

The `highlight.renderOptions` callback overrides metadata line numbering, start numbers, and highlight selections.
Its diff selections combine with presentation selections. Its hooks combine with the required presentation hooks.
Presentation attributes for copy exclusion, source lines, roles, and labels are reserved.
Conflicting hook attributes throw errors. Token and code hooks retain their existing behavior.
Per-block callbacks cannot replace resource limits.

The existing highlighting error policy applies to syntax failures.
With `errorPolicy: 'plain'`, the plugin renders escaped plain presentation after a failure.
Presentation limits and outer wrapper errors still propagate.

## Copy controls

```typescript
import { createParser } from '@lpm.dev/neo.markdown'
import { codePresentationPlugin } from '@lpm.dev/neo.markdown/plugins/code-presentation'
import { copyCodePlugin, initializeCopyCode } from '@lpm.dev/neo.markdown/plugins/copy-code'

const parser = createParser({
  plugins: [codePresentationPlugin(), copyCodePlugin()],
})

// After the application mounts the rendered HTML:
const cleanup = initializeCopyCode({ root: document.querySelector<HTMLElement>('#content')! })
// During component cleanup:
cleanup()
```

Copy output contains added, modified, and unchanged code lines.
It excludes removed lines, diff prefixes, captions, filenames, and line-number gutters.
The copy initializer reads line content from the rendered DOM. It does not retain a second source payload.
An all-removed block copies an empty string.
Normal browser selection does not apply the copy plugin's exclusion policy.

## Styles, accessibility, and limits

The default class prefix is `neo-code`. `getCodePresentationStyles({ classPrefix })` accepts a custom prefix.
The syntax theme prefix remains independent.
Presentation CSS uses `--neo-code-added-bg`, `--neo-code-removed-bg`, `--neo-code-modified-bg`, and `--neo-code-highlight-bg` for background overrides.

The focus effect never removes code or adds `aria-hidden` to source lines.
Pointer hover and keyboard focus restore full opacity. Increased-contrast preferences also restore full opacity.
Code regions have labels, `tabindex="0"`, and visible focus outlines.
Diff lines have text markers and accessible group labels. Line numbers and decorative gutters are hidden from assistive technology.
Generated markup uses no IDs, global counters, inline event handlers, or hydration state.

The plugin emits one presentation stylesheet per document by default.
For an external stylesheet, set `injectStyles: false` and use `getCodePresentationStyles()`.
For highlighted class output, supply the matching syntax stylesheet too.
The built-in sanitizer preserves figures, captions, presentation attributes, and code-region keyboard access.

| Plugin limit | Default | Applies to |
| --- | ---: | --- |
| `maxInputLength` | 250,000 | Original source, before prefix removal |
| `maxLines` | 10,000 | Rendered lines, including a final empty line |
| `maxRenderedLength` | 10,000,000 | Complete figure HTML, excluding the shared stylesheet |

Limits accept non-negative safe integers or `Infinity`.
The highlighting engine retains its separately configured limits.
The plugin adds source traversal and line wrappers only in documents that use it.

## Structured results

`parser.parseDocument()` returns used presentation and theme styles separately from HTML.
It also collects metadata diagnostics without replacing `onDiagnostic` or highlighting callbacks.
See [document results](./document-results.md) for asset setup, diagnostic locations, and collection limits.
