# Incremental documents

Stable imports and legacy aliases follow the [API stability contract](./api-stability.md).

`@lpm.dev/neo.markdown/incremental` provides an opt-in session for repeated document updates.
The session resumes block parsing at safe checkpoints and reuses unchanged inline tokens.
Every update renders the complete document. The API does not emit HTML patches.

```typescript
import { createIncrementalMarkdown } from "@lpm.dev/neo.markdown/incremental";

const session = createIncrementalMarkdown({ parser: { gfm: true } });
try {
  const first = session.append("# Example\n\nA **paragraph**.\n");
  const next = session.append("\nA second paragraph.\n");
  console.log(first.html, next.html, session.metrics);
} finally {
  session.dispose();
}
```

`update(source, documentOptions?)` replaces the complete source.
`append(chunk, documentOptions?)` appends a string chunk.
Both methods return the same structured result as `parseDocument()` for the current complete source.
Each result contains HTML, stylesheet assets, diagnostics, and TOC entries.
Results remain immutable and isolated from later calls.
The existing string-returning API remains unchanged.

## Block checkpoints and references

Each completed top-level block records its source boundary and inspected dependency range.
Dependencies include unsuccessful rule probes and text inspected after a block ends.
An optional reference title can depend on several later lines.
Blank lines after indented code can also depend on later input.

An update compares normalized source and resumes from the first affected checkpoint.
Earlier blocks remain available for reuse.
Parsing stops after it reaches an old boundary within the unchanged suffix.
Fences, tables, lists, and blockquotes also retain a safe cursor inside the block.
The cursor stays behind the final line and any required lookahead.
Appends resume scanning from that cursor when its inspected source remains unchanged.
Edits before the saved dependency boundary restart the affected block.
HTML blocks and indented code still restart from their opening.

A fence retains its stripped code prefix. A table retains its header, alignment, and completed rows.
Lists retain completed items and the current item's scan state, including blank lines and paragraph state.
Blockquotes retain stripped lines and lazy continuation positions.
Each container scope retains at most one child cache for its active item or quoted content.
Child caches apply the same dependency checks, including changes to lazy continuation positions.
This permits continuation inside a fence or table nested in a list or blockquote.

Reference definitions are collected again in document order from the resulting blocks.
The first matching definition retains precedence, including definitions inside lists and blockquotes.
The inline cache records each reference lookup, including unresolved labels.
A changed definition invalidates only entries that depend on that label.
Unrelated inline tokens remain reusable.

Cache hits preserve structural and inline UGC token-budget charges.
Cache entries remain private to one session and the built-in rendering path reads them without mutation.

By default, plugins, custom blocks, and caller renderer overrides disable reuse because their calls or mutations can be observable.
Declared render plugins and pure inline plugins can use the opt-in paths described next.
Fallback sessions still use the complete parser pipeline.
The cache never stores final HTML, stylesheet collections, diagnostics, or TOC data.

Dependency invalidation handles changes to earlier lists, tables, setext headings, blockquotes, and fences.
Chunk boundaries can split CRLF sequences and Unicode surrogate pairs.
These sessions preserve the existing CommonMark and GFM URL restrictions.

The `parser` option accepts the normal parser options.
For structural sanitization, supply the sanitizer provider just as for the normal parser:

```typescript
import { sanitizeHtml } from "@lpm.dev/neo.markdown/sanitized";

const source = "<p>Example</p>";
const safeSession = createIncrementalMarkdown({
  parser: { allowHtml: true, sanitize: true, sanitizer: sanitizeHtml },
});
try {
  console.log(safeSession.update(source).html);
} finally {
  safeSession.dispose();
}
```

## Declared render plugins

`pluginReuse` defaults to `"off"`. The `"declared"` option permits reuse when every plugin has a supported declaration.
`defineIncrementalPlugin(plugin, contract)` returns a new plugin function and copies its contract.
It leaves the original plugin unchanged. Existing plugin factories do not declare themselves automatically.

```typescript
import {
  createIncrementalMarkdown,
  defineIncrementalPlugin,
} from "@lpm.dev/neo.markdown/incremental";
import { tocPlugin } from "@lpm.dev/neo.markdown/plugins/toc";
import { codePresentationPlugin } from "@lpm.dev/neo.markdown/plugins/code-presentation";
import { copyCodePlugin } from "@lpm.dev/neo.markdown/plugins/copy-code";

const plugins = [
  defineIncrementalPlugin(tocPlugin(), { protocol: 1, id: "toc", profile: "render" }),
  defineIncrementalPlugin(codePresentationPlugin(), {
    protocol: 1, id: "presentation", profile: "render",
  }),
  defineIncrementalPlugin(copyCodePlugin(), { protocol: 1, id: "copy", profile: "render" }),
];
const session = createIncrementalMarkdown({ pluginReuse: "declared", parser: { plugins } });
try {
  const source = "# Example\n\n```js filename=app.js\nconst value = 1;\n```";
  session.update(source);
  const result = session.update(source.replace("1;", "2;"));
  console.log(result.html, result.stylesheets, result.toc, session.reuse);
} finally {
  session.dispose();
}
```

The standalone highlight plugin supports the same declaration:

```typescript
import { createIncrementalMarkdown, defineIncrementalPlugin } from "@lpm.dev/neo.markdown/incremental";
import { highlightPlugin } from "@lpm.dev/neo.markdown/plugins/highlight";
import { tokenize, renderToHTML } from "@lpm.dev/neo.highlight";
import { javascript } from "@lpm.dev/neo.highlight/grammars/javascript";

const syntax = { grammars: [javascript], tokenize, renderToHTML };
const plugin = defineIncrementalPlugin(highlightPlugin(syntax), {
  protocol: 1, id: "highlight", profile: "render",
});
const session = createIncrementalMarkdown({ pluginReuse: "declared", parser: { plugins: [plugin] } });
try {
  console.log(session.update("```js\nconst value = 1;\n```").html);
} finally {
  session.dispose();
}
```

For presentation with syntax colors, pass `syntax` through `codePresentationPlugin({ highlight: syntax })` and declare that plugin.
Install `@lpm.dev/neo.highlight` separately for either syntax example.
These plugins retain their normal stylesheet and sanitizer options.

The declaration helper and session factory must come from the same incremental module instance.
Separate installed copies and ESM/CommonJS instances have separate declaration registries.
A wrapper from another instance selects `undeclared-plugin` fallback.
The original plugin can come from either format if the session's own helper wraps it.

## Pure inline rules

The `inline` profile permits custom inline rules with deterministic results and no observable effects.
Each rule can depend on its source argument, fixed setup data, and declared external dependencies.
The declaration is an author assertion. It does not prove purity or isolate untrusted JavaScript.
The option still defaults to `pluginReuse: "off"`.

```typescript
import { createIncrementalMarkdown, defineIncrementalPlugin } from "@lpm.dev/neo.markdown/incremental";

let dictionary = new Map([["neo", "/guide/neo"]]);
let revision = "1";
const glossary = defineIncrementalPlugin(builder => {
  builder.addInlineRule({
    name: "glossary",
    triggerChars: [64],
    tokenize(source) {
      const match = /^@([a-z]+)/.exec(source);
      const href = match && dictionary.get(match[1]);
      if (!match || !href) return null;
      return {
        raw: match[0],
        token: {
          type: "link", raw: match[0], href,
          tokens: [{ type: "text", raw: match[0], text: match[1] }],
        },
      };
    },
  });
}, {
  protocol: 1, id: "glossary", profile: "inline", effects: "none",
  dependencies: { kind: "revision", read: () => revision },
});

const session = createIncrementalMarkdown({ pluginReuse: "declared", parser: { plugins: [glossary] } });
try {
  console.log(session.update("Read @neo.").html);
  dictionary = new Map([["neo", "/guide/neo-v2"]]);
  revision = "2";
  console.log(session.update("Read @neo.").html);
  console.log(session.metrics.pluginInvalidations); // 1
} finally {
  session.dispose();
}
```

For immutable external dependencies, use `dependencies: { kind: "static" }`.
A revision getter must return one primitive string, synchronously and without effects.
It must change whenever any external tokenization dependency changes.
Dependency state must remain stable from revision sampling through the end of tokenization.
Render callbacks can change that state afterward. The next update must observe a changed revision.

Rules cannot depend on invocation counts, object identity, time, randomness, I/O, or undeclared mutable state.
They cannot change external state or retain returned mutable graphs for later changes.
Each successful call transfers ownership of a fresh mutable token graph to the current parse.
Rules cannot reuse that mutable graph in another call.

### Revision sampling and invalidation

The session reads each revision once, in plugin order, before tokenization on every accepted update attempt.
This includes identical source and empty appends. Input, update, and source-work limits apply first.
Each revision can contain at most 1,024 UTF-16 units. The complete vector can contain at most 65,536 units.
Getter execution and revision strings count toward cumulative work limits.

The session compares ordered strings directly. It does not concatenate or hash the vector.
The first vector establishes the initial generation.
Each later difference clears all inline cache entries and their reference metadata before tokenization.
Built-in block checkpoints remain available. Source and reference changes retain their normal dependency checks.
Only the latest vector remains in memory. A–B–A changes each invalidate the cache.
`pluginInvalidations` counts these revision transitions, including changes with identical source.

A getter failure or invalid revision closes the session before tokenization or rendering.
Non-string revisions throw `TypeError`. Oversized revisions throw `RangeError`.
The runtime does not retry the update through complete parsing.
Fallback sessions never read revisions.

### Guarded callback services

During inline tokenization and revision sampling, every declared builder denies access to `document`, `renderInline`, and `renderBlock`.
The guards also cover retained rendering functions and builders from another plugin in the same session.
These services can invoke rendering callbacks or collect document effects, so pure inline rules cannot use them.
Downstream transforms and renderers retain access to these services.

A detected violation closes the session and throws `TypeError`.
Catching the immediate error cannot permit tokenization or rendering to continue.
Late registration also closes the session.
Disposal or same-session reentrancy prevents the active update from returning a result.
Arbitrary closure effects remain the plugin author's responsibility.

### Custom token snapshots

Before mutable downstream callbacks run, the inline cache stores a detached snapshot of eligible custom tokens.
The current occurrence retains its original graph. Cache hits receive separate copies.
Snapshots preserve aliases, null-prototype records, sparse arrays, and mutable extension fields.

Supported snapshots contain ordinary mutable records, arrays, strings, numbers, booleans, `null`, and `undefined`.
Frozen or sealed records, accessors, hidden properties, unusual descriptors, behavioral prototypes, functions, symbols, bigints, and cycles receive no cache storage.
Accessor result envelopes also receive no cache storage.
Inspection does not call property getters or custom cloning hooks.
Proxies are outside this data contract. JavaScript reflection cannot reliably identify them across runtimes.

Unsupported or oversized graphs continue through the normal parser pipeline for that occurrence.
The runtime does not call the rule again as a fallback.
Normal token validation still rejects invalid token structures and excessive render depth.
Snapshot inspection stops at cache capacity or depth limits. Work exhaustion still closes the session.

## Registration rules

Both profiles support token transforms, HTML transforms, code hooks, and renderer registrations.
The `inline` profile also permits pure inline rules. The `render` profile does not permit inline rules.
Actual plugin setup runs once. Composed plugins use the outer declaration and registration scope.
All declarations require a unique ID of 1–128 UTF-16 units.
The helper rejects malformed contracts and accessor properties without invoking contract getters.
Generic `.pure` and `.incremental` properties do not declare a plugin.

Declared setup receives a frozen facade with the documented `PluginBuilder` methods, `options`, and `document`.
The facade exposes no internal registration arrays or parser objects.
Its plugin list is a frozen snapshot of the original declarations.
Registration must finish during that plugin's setup.
Changes to plugin order, registrations, or parser grammar options require a new session.

Custom block registrations always select complete parsing for the whole session.
Inline registrations under a render declaration also select complete parsing.
Preflight blockers also select complete parsing, with no second setup call.
Render declarations need no purity assertion because the session never skips their callbacks.
The runtime snapshots documented inline rule metadata, including the callback, priority, and trigger codes.
Rule callbacks receive the frozen metadata snapshot as `this`.
Original rule objects and trigger arrays cannot change the registered grammar afterward.
Rule metadata requires ordinary data fields. Accessors, unsupported fields, and invalid trigger codes select fallback.
Aggregate rule metadata can contain at most 65,536 units: name and priority string units, trigger entries, and one unit per rule.

## Token ownership and callbacks

Before callbacks receive retained tokens, the session copies the built-in block graph and each cached inline occurrence.
Copies preserve aliases within a graph. Repeated inline text receives separate copies for each occurrence.
Callbacks can mutate or retain their own tokens without changing caches or tokens from earlier updates.
The path without plugins retains its existing behavior without copies.
Object identity across updates is not part of the declared plugin API.

Token transforms, renderers, code hooks, and highlighting run again on every update, including identical source.
TOC callbacks, diagnostics, stylesheet collection, sanitization, and trusted HTML transforms also run again.
The order remains token transforms, rendering with code hooks, sanitization, then trusted HTML transforms.
Final HTML and document contributions receive no cache storage.
Normal hook contexts and structured results remain immutable.

After declared setup succeeds, a late registration throws `TypeError` and closes the session.
Reentrant `update` or `append` calls on the same declared session also throw and close it.
Disposal during a callback prevents the active update from returning a result.
Swallowing a registration or reentrancy error cannot restore the session.
Errors propagate without a second parse or repeated callback execution.
Independent sessions and ordinary parsers remain usable inside callbacks.

## Reuse policy

The read-only `session.reuse` report contains `mode`, `blockers`, and `truncated`.
`built-in` means that the session uses the path without plugins.
`declared` means that all plugins passed the registration checks for their profiles.
`fallback` means that the session uses complete parsing.
The policy stays fixed for the session and remains separate from document diagnostics.

| Blocker code | Reason |
| --- | --- |
| `plugin-reuse-off` | Plugins are present and `pluginReuse` is `"off"`. |
| `undeclared-plugin` | A plugin has no declaration from this incremental module instance. |
| `unsupported-contract` | Reserved for future unsupported contracts. The current helper rejects unknown profiles before setup. |
| `duplicate-plugin-id` | Multiple declarations use the same ID. |
| `caller-block-rules` | `parser.blocks` is present. |
| `caller-renderer` | `parser.renderer` is present. |
| `custom-block-rules` | Plugin setup registers a block rule. |
| `registration-mismatch` | A registration violates its profile, uses a completed scope, or supplies unsupported inline rule metadata. |
| `contract-limit` | Setup exceeds 64 declarations, 1,024 registrations, or the inline rule metadata limit. |

Blockers include a zero-based `pluginIndex` and `pluginId` where applicable.
The report retains at most 16 blocker records. `truncated: true` means that more blockers exist.
Metadata limits disable reuse without discarding actual plugin registrations.

## Limits and cleanup

All session limits require non-negative safe integers.

| Option | Default | Scope |
| --- | ---: | --- |
| `maxInputLength` | 250,000 | Current source length in UTF-16 units. A smaller parser limit also applies. |
| `maxUpdates` | 10,000 | Successful updates. |
| `maxWorkCodeUnits` | 16,000,000 | Cumulative source, token strings, graph accounting, and copy work. |
| `maxEntries` | 512 | Retained inline cache entries. |
| `maxCachedCodeUnits` | 128,000 | Total source text in cache keys. |
| `maxCachedTokens` | 50,000 | Inline token nodes. Custom snapshots also count records, arrays, property slots, and array slots, including holes. |
| `maxCachedTokenCodeUnits` | 1,000,000 | Inline token strings and reference strings. Custom snapshots also count property names and extension strings. |
| `maxCachedReferenceDependencies` | 10,000 | Reference lookups retained across inline cache entries. |
| `maxBlockCheckpoints` | 4,096 | Retained block checkpoints per scope. Nested checkpoints also count toward the structural node limit. |
| `maxCachedBlockTokens` | 50,000 | Retained structural nodes and array slots, including continuation snapshots and child caches. |
| `maxCachedBlockCodeUnits` | 1,000,000 | Retained block strings, continuation strings, and nested source copies. |

The inline cache evicts older entries to meet its limits. An oversized inline entry receives no cache storage.
If a document exceeds a block-cache limit, its block checkpoints are discarded after that update.
The result remains complete. Later updates can still use the inline cache.
The normalized top-level source is also retained within the document input limit, plus one possible final newline.
Nested source copies count toward the block string limit.
Structural size accounting caches immutable subgraphs and counts shared references conservatively.
These limits measure logical retained data, not exact heap bytes.

The work budget includes complete source comparisons, dependency reads, graph accounting, and rendering.
Declared reuse also charges copied objects, property slots, and string units before copying them.
Custom snapshot inspection and revision sampling also count toward this budget.
Temporary token copies remain subject to source, depth, UGC, and cumulative work limits.
Caller-retained callback tokens and results remain the caller's memory responsibility.
Arbitrary plugin callbacks have no execution deadline or exact heap quota.
This counter measures source and token units, not CPU instructions or wall-clock time.
Normal parser, sanitizer, UGC, and structured-result limits still apply.

`metrics` reports parsed and reused blocks, block source units, inline source units, and retained cache sizes.
`blockCheckpoints` reports top-level checkpoints. Nested state contributes to the retained node and string counters.
`continuationHits` counts restored cursors, including cursors inside nested blocks.
`continuedCodeUnits` totals the source prefixes skipped by those cursors.
Nested prefixes can overlap outer prefixes, so this total is not a count of distinct document units.
`parsedBlockCodeUnits` still counts complete affected top-level block spans, including any continued prefixes.
These counters do not measure CPU instructions or elapsed time.
Block metrics cover both reuse paths. Fallback leaves block counters at zero.
`clonedTokenNodes` counts copied arrays and records. `clonedTokenCodeUnits` counts string units processed during copies and snapshots.
These cumulative counters measure copy work, not live memory or allocation bytes.
`lastBlockRestart` and `lastBlockParsedThrough` describe the most recent resumed region in normalized UTF-16 source units.
Normalization converts CRLF and CR to LF, replaces NUL, and adds a missing final newline.
These positions are diagnostic counters, not edit coordinates in the original input.
`referenceInvalidations` counts changed reference maps. `invalidatedInlineEntries` counts the affected cache entries.

`dispose()` releases the source, caches, and parser references. Repeated disposal is safe.
A parsing or resource failure closes the session and releases its state.

### Limit errors and recovery

`IncrementalMarkdownLimitError` extends `RangeError` and identifies a session limit through its `limit` property.
The values are `maxInputLength`, `maxUpdates`, and `maxWorkCodeUnits`.
Existing limit messages remain unchanged. Parser, plugin, revision, and configuration errors retain their existing types.
The error class and session must come from the same module instance for `instanceof` checks.

```typescript
import { createIncrementalMarkdown, IncrementalMarkdownLimitError } from "@lpm.dev/neo.markdown/incremental";

const session = createIncrementalMarkdown({ maxUpdates: 1 });
try {
  session.update("# First document");
  session.update("# Second document");
} catch (error) {
  if (!(error instanceof IncrementalMarkdownLimitError)) throw error;
  console.log(error.limit); // maxUpdates
} finally {
  session.dispose();
}
```

A limit error does not promise that an update is safe to retry.
Work exhaustion can occur after inline callbacks or other plugin effects.
An ordinary `RangeError` can also indicate a plugin error, even with the same message as a session limit.

Before an update reaches `maxUpdates`, dispose the old session.
Create a replacement with the same configuration.
Use cumulative work metrics to select an earlier rotation threshold.
A soft threshold leaves room for another update but cannot predict arbitrary plugin work.
Each replacement still needs finite input, work, and cache limits.

If an update fails, release the session and show a preview error.
Keep the editor text available for correction. A later edit or explicit refresh can start a fresh session.
Do not automatically repeat the failed parse or switch it to another parser.
If a single document exceeds the input limit, require a shorter document before parsing it again.

## Application lifecycle

An incremental session belongs to one editor or document stream. It retains source and dependency state.
Keep ordinary shared parsers separate from these mutable sessions.
Create the session after the component mounts, outside React rendering and state initializers.
Dispose it on unmount and before changes to plugins, parser configuration, or document ownership.
Keep configuration identity stable between source edits.

The Markdown demo uses `useMarkdownDocument()` to own a dedicated worker after commit. The worker owns the incremental parser session.
New edits replace queued source and supersede previous promises. Active computation continues until its response or deadline.
Cleanup disposes the owner, including during StrictMode effect replay.
The synchronous example hook remains available for integrations that use frame scheduling.
The hook accepts a result only for the current source, configuration, and refresh attempt.
The example stream also cancels on manual edits, template selection, configuration changes, and unmount.
The application retains the complete source and calls `update()` for each accepted prefix.
This permits coalescing and session rotation without losing skipped chunks.

While an edit waits, the demo marks the previous complete preview as busy.
Configuration changes hide the previous result immediately. Errors clear the preview and its stylesheet, diagnostic, and TOC data.
The preview uses the separate DOM view to preserve unchanged top-level regions and their initialized controls.
Changed regions run their scoped copy-code and embed cleanup functions before removal.
See [DOM patches](./dom-patches.md) for matching, fallback, and ownership rules.
Embeds keep the complete-parser fallback because they register custom blocks.
Presentation, highlighting, copy-code, and TOC use explicit render declarations.

The demo rotates after 1,000 successful updates or 75% of its 16,000,000-unit work budget.
It also rotates before an update whose initial source charge exceeds the remaining work budget.
The input ceiling remains 250,000 UTF-16 units. These values are application policy, separate from the package defaults.
An interrupted parse never triggers an automatic retry. Explicit refresh performs one attempt with the same finite limits.

For hydration, the editor renders the same pending shell on the server and the first client render.
Effects produce the first preview after hydration. The shell contains no server-rendered document HTML.
Applications that require document HTML on the server can keep their existing `parseDocument()` integration.
Incremental sessions are not serialized across that boundary.

The worker moves parsing, highlighting, and sanitization off the main thread.
Updates still return complete document results. The DOM view consumes their HTML separately.
See [worker sessions](./worker-sessions.md) for deadlines, limits, and recovery.
The [application adapter](./application-adapter.md) supplies a public React hook and framework-neutral ownership.

The API retains the package requirement for Node 22.12 or later.
The public APIs follow the [stability contract](./api-stability.md). Reuse benefits depend on the document and enabled parser options.
Continuation reduces repeated grammar scanning but still copies retained arrays and assembles complete token trees.
Small blocks, unsupported open blocks, and repeated earlier edits can make incremental updates slower than complete parsing.
Source comparison, reference collection, and complete rendering still scale with document size.
Declared reuse adds token copies and can cost more than complete parsing.
Measure complete updates with application documents and plugins before enabling the option.

```sh
lpm run test:incremental
```

The suite checks every CommonMark fixture and normative GFM extension fixture through character prefixes.
It also checks randomized edits, reference dependencies, sanitizer behavior, UGC limits, cache bounds, and structured results.
Continuation checks compare exact structural tokens, source spans, budget charges, nested boundaries, and previous result snapshots.
Plugin checks cover registration mismatches, token mutation, callback order, module formats, cleanup, and complete-result parity through edits.
Pure inline checks cover guarded services, revisions, unsupported snapshots, complete syntax fixtures, and Unicode chunk boundaries.

## Code line layout in live views

The highlight plugin accepts `wrapLines: "source"` with a renderer that supports source-preserving line spans.
It also accepts a per-block `wrapLines` value from `renderOptions`.

```typescript
highlightPlugin({ grammars, tokenize, renderToHTML, wrapLines: "source" });
```

This mode retains physical line endings as text and lets browsers reuse layout for unchanged code rows.
The DOM view reuses those rows through its existing bounded code cache.
Markdown still normalizes source newlines before highlighting.
The copy-code initializer recognizes source-line spans and does not add extra newline separators.
Diff exclusions and hidden line numbers retain their copy behavior.

This option does not reduce complete rendering or sanitization work.
It adds line nodes and HTML, so measure the consuming application before enabling it.
The default remains unchanged.
