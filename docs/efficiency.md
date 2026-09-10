# Runtime and output efficiency

Reuse a parser instance for multiple documents. This avoids repeated rule and plugin initialization.
Plain text that requires no inline syntax uses a direct path without link or delimiter indexes.
Custom inline rules retain their priority. Entity decoding, token budgets, and compatibility expectations remain unchanged.

The named-entity table loads on the first named-entity lookup. Documents without named entities do not expand this table.
A first entity lookup can cost more than later lookups. The benchmark measures these cases in separate processes.

## Highlighted output

The highlight plugin supports `styleMode: "class"` with current `neo.highlight` builds.
This mode requires a matching theme stylesheet. The default remains `"inline"`.

```ts
import { createParser } from '@lpm.dev/neo.markdown'
import { highlightPlugin } from '@lpm.dev/neo.markdown/plugins/highlight'
import { tokenize, renderToHTML, getThemeStylesheet } from '@lpm.dev/neo.highlight'
import { javascript } from '@lpm.dev/neo.highlight/grammars/javascript'
import { githubDark } from '@lpm.dev/neo.highlight/themes/github-dark'

const css = getThemeStylesheet(githubDark)
const parser = createParser({
  plugins: [highlightPlugin({
    grammars: [javascript],
    tokenize,
    renderToHTML,
    theme: githubDark,
    styleMode: 'class',
    injectStyles: false,
  })],
})
const html = parser.parse('```js\nconst value = 42\n```')
```

Serve `css` once through an application-managed stylesheet. Insert `html` into the document.
Use matching class prefixes for HTML and CSS. Different prefixes isolate independent themes on the same page.

For a self-contained document, supply `getThemeStylesheet` to the plugin and omit `injectStyles: false`.
The plugin generates the stylesheet once at creation and includes it once per rendered document.
For a single small block, inline output can require fewer total compressed bytes than HTML with a complete stylesheet.

The structural sanitizer preserves highlighting classes. Class mode does not require a broader CSS allowlist.
Copy controls retain source text without line numbers or diff gutters.

## Measurements

These commands run from a package repository checkout.

```sh
lpm run build
lpm run bench:efficiency
lpm run check:tree-shaking
```

The runtime script prints JSON for short text, prose, mixed Markdown, and entity-heavy text.
It uses a GFM parser. Ordinary first calls and entity-heavy first calls run in separate fresh processes.
Each mode runs three times. Each fixture has seven warm batches.

Results include import time, initialization, first-call time, retained heap, process peak RSS, and output size.
Heap measurements use explicit garbage collection. Peak RSS includes Node.js and the benchmark harness.
The tree-shaking script reports browser bundles separately, including the structural sanitizer entry.
Timings depend on the runtime, machine, input, and options. The scripts do not measure browser painting or hydration.

## Browser measurements

Production browser measurements cover different costs from parser benchmarks and simulated DOM tests.
An editing preview includes parsing, highlighting, sanitization, HTML staging, DOM updates, layout, and paint.
Fewer replaced elements do not guarantee lower interaction latency.
Frame scheduling can hide a reduction in processing time.

Use a production application build with representative documents and plugin configuration.
Measure editing and streamed input separately.
Record processing time, input-to-preview delay, long tasks, and memory after repeated updates and disposal.
Alternate baseline and candidate runs after warmup.
Compare complete HTML, stylesheets, diagnostics, and TOC data before accepting timing results.
Keep instrumentation and browser trace collection separate from final latency samples.

The experimental DOM view reuses validation for unchanged canonical regions.
It still parses complete changed HTML strings in an inert template.
Incremental parser sessions still run rendering callbacks and sanitization on each update.
DOM reuse does not authorize reuse of plugin output or removal of sanitizer calls.
