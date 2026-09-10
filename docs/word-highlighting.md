# Word highlighting

The [presentation plugin](./code-presentation.md) accepts `mark` metadata for selected text inside code blocks.
It supports plain code, syntax highlighting, focus, diff notation, and copy controls.

````markdown
```typescript caption="Load items" filename="src/client.ts" diff focus=2 lines start=20 mark="2:7-2:15,3:30-3:38"
- const endpoint = "/api/old-items";
+ const endpoint = "/api/items";
  const response = await fetch(endpoint);
```
````

This example selects `endpoint` on source lines 2 and 3.
Displayed line numbers start at 20, but the selection positions still start at source line 1.
The copy control excludes the removed line and diff prefixes. Word selections do not change the copied source.

## Positions

Each selection uses `startLine:startColumn-endLine:endColumn`. Commas separate selections.
Line numbers and columns start at one. The start is inclusive. The end is exclusive.
Columns count Unicode code points in the displayed code after diff-prefix removal.

For `😀 café`, `mark="1:1-1:2,1:3-1:7"` selects the emoji and `café`.
The emoji occupies one column. A tab also occupies one column, regardless of its displayed width.
Combining marks count separately. Columns do not count grapheme clusters, UTF-16 units, or visual character widths.

````markdown
```text mark="1:3-2:5"
alpha
beta
```
````

This multiline selection marks `pha` and `beta`. Line terminators remain outside the highlight spans.
The column immediately after the final character is a valid endpoint.
An empty line supports column 1. A selection that covers only a terminator produces no visible word highlight.

## Invalid metadata and limits

The plugin accepts at most 256 ranges before merging. The metadata parser retains its existing size limit.
Duplicate, overlapping, and adjacent ranges merge.
Malformed, empty, reversed, or out-of-bounds ranges invalidate the entire `mark` field.
The plugin preserves the source and reports a diagnostic with `field: 'mark'` through `onDiagnostic`.
Other valid presentation fields still apply.

The plugin retains its input, line, and output limits. Word spans count toward the output limit.
Unknown languages use plain presentation with the same metadata selections.

## Syntax and application ranges

The highlighting configuration also accepts `highlightRanges` globally or through `renderOptions(context)`.
These application ranges use zero-based UTF-16 offsets with an exclusive end, matching the highlighter's rendering hooks.
They refer to the code after diff-prefix removal.

```typescript
import { codePresentationPlugin } from '@lpm.dev/neo.markdown/plugins/code-presentation'
import { tokenize, renderToHTML } from '@lpm.dev/neo.highlight'
import { typescript } from '@lpm.dev/neo.highlight/grammars/typescript'

codePresentationPlugin({
  highlight: {
    grammars: [typescript], tokenize, renderToHTML,
    renderOptions(context) {
      const start = context.source.indexOf('endpoint')
      return {
        highlightRanges: start < 0 ? [] : [{ start, end: start + 8 }],
      }
    },
  },
})
```

The selection order is:

1. Per-block `renderOptions(context).highlightRanges`, including an empty array.
2. The block's `mark` field, including invalid metadata that resolves to an empty selection.
3. Global `highlight.highlightRanges`.

Application ranges only apply to syntax rendering. Unknown languages do not invoke `renderOptions`.
With `errorPolicy: 'plain'`, syntax failures use the metadata selections for plain output.
This recovery does not reuse invalid application ranges.
The separate `highlightPlugin()` also accepts application ranges, but it does not interpret `mark` metadata.

Syntax boundaries can split one selection into several spans. The renderer preserves token colors, nesting, source offsets, and hook calls.
Focus and diff styles combine with the word background. Word selections never include line numbers or diff gutters.

## Styles and sanitization

Plain presentation uses `neo-code-word-highlight` and the `--neo-code-word-highlight-bg` CSS variable.
Highlighted presentation uses `neo-hl-word-highlight` and `--neo-hl-word-highlight-bg` by default.
Custom presentation and syntax prefixes remain independent.

`getCodePresentationStyles()` includes the plain rule. The highlighter's single and dual theme stylesheets include the syntax rule.
Both rules use a neutral background and preserve text color.
For sanitized output, use class mode and supply both external stylesheets as described in the presentation guide.
The built-in sanitizer preserves word spans and their classes.
