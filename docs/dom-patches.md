# DOM patches

Stable imports and legacy aliases follow the [API stability contract](./api-stability.md).

`@lpm.dev/neo.markdown/dom` updates an owned HTML `div` from complete HTML strings.
It preserves unchanged regions and patches compatible descendants inside changed code blocks and containers.
Each top-level region is one element, text node, or comment.
The synchronous parser APIs and structured document results remain unchanged.

## Basic use

```typescript
import { createParser } from "@lpm.dev/neo.markdown";
import { createMarkdownView } from "@lpm.dev/neo.markdown/dom";

const root = document.createElement("div");
document.body.append(root);
const parser = createParser();
const view = createMarkdownView(root);
try {
  view.update(parser.parse("# Guide\n\nFirst version.\n\nUnchanged footer."));
  const heading = root.firstChild;
  const report = view.update(parser.parse("# Guide\n\nSecond version.\n\nUnchanged footer."));
  console.log(root.firstChild === heading, report.reusedRegions);
} finally {
  view.dispose();
  root.remove();
}
```

The entry has no DOM access during import. Creating a view requires a DOM element.
The root must be an HTML `div`, because fragment parsing depends on its context.
The first update replaces existing children. The view owns those children until disposal.
`dispose()` releases retained HTML, node references, and lifecycle callbacks, and clears the root.
Repeated disposal is safe. Updates after disposal throw.

The HTML must already satisfy the application's trust and sanitizer policy.
This adapter is not a sanitizer. It does not call a Markdown parser or repeat its callbacks.
Stylesheets, diagnostics, and TOC data remain application-owned parts of the complete document result.

## Matching and retained state

The adapter parses eligible input in an inert template and records canonical HTML and bounded node snapshots.
It compares the common prefix and suffix without overlapping their ranges, then pairs remaining siblings by position.
Equal siblings remain in place, including those between separate edits.
The optional code cache also retains matching code nodes when their containers move or change.
Compatible changed nodes receive patches. Other changed nodes receive replacement.
An unchanged HTML string skips parsing while the view still owns its top-level nodes.

Unchanged canonical regions reuse their previous validation and snapshots.
Each occurrence still counts toward the node limit, including duplicate regions.
Changed regions receive fresh validation. Their current node counts replace the previous counts after a patch.
Live initializer state never supplies canonical validation data.

Top-level matching uses full strings. Nested matching uses complete canonical structure.
A hash rejects unequal nested candidates, but a hash match always requires complete structural comparison.
Equal snapshots can describe multiple regions, but each new region receives its own live node references.
Duplicate regions match by position. Reordering does not imply stable identity for duplicate content.
Parser corrections to lists, tables, references, or fences arrive as a new complete HTML string.
The view does not infer Markdown dependencies or source offsets.

Unchanged regions retain focus, selection, scroll offsets, copy feedback, and initialized embed state.
Compatible changed containers retain their own nodes and unchanged descendants.
Replaced nodes lose their previous control state.
An initializer can change its own descendants without changing the canonical snapshot.
Changes to top-level ownership trigger complete replacement on the next update.

Keep other writers out of the owned subtree, except for registered initializers and normal control interaction.
After unrelated descendant mutations, dispose and recreate the view before further updates.
Before a nested patch, the adapter checks child ownership in ordinary containers.
Changed child ownership selects replacement for that region. The adapter does not compare every live attribute or text value against canonical HTML.

## Nested patches

`patchChildren` defaults to `true`. A view without an initializer can patch ordinary content containers directly.
Supported containers include code, syntax spans, presentation figures, blockquotes, lists, table rows, and cells.
Different element types or IDs receive replacement. Attributes follow the next canonical output, including their serialization order.
Text updates preserve the text node and change only the differing character range.
Matching uses UTF-16 offsets and preserves the complete output across Unicode and unfinished input.

Controls, media, editable elements, and unknown element types are atomic.
An unchanged atomic subtree keeps its live state. A changed atomic subtree receives complete replacement.
Embed-containing regions retain complete replacement, including regions with `.embed`, `.twitter-tweet`, `data-embed-*`, or `data-neo-embed-*` markers.
The view does not infer widget ownership from arbitrary application code.

An ordinary initializer callback keeps complete replacement for its changed region, even if it returns `undefined`.
A returned lifecycle object explicitly permits nested patches in that scope.

```typescript
import { createMarkdownView } from "@lpm.dev/neo.markdown/dom";
import { initializeCopyCode } from "@lpm.dev/neo.markdown/plugins/copy-code";

const root = document.createElement("div");
document.body.append(root);
const view = createMarkdownView(root, {
  initialize(region) {
    const copy = initializeCopyCode({ root: region });
    return { dispose: copy, update: copy.refresh };
  },
});
try {
  view.update('<div data-copy-code-wrapper><button data-copy-code>Copy</button><pre><code>old</code></pre></div>');
  view.update('<div data-copy-code-wrapper><button data-copy-code>Copy</button><pre><code>new</code></pre></div>');
} finally {
  view.dispose();
  root.remove();
}
```

`MarkdownViewLifecycle` requires `dispose` and `update` functions.
The declaration gives the view ownership of canonical container descendants.
The `update` callback runs once after a changed region receives its nested patches.
It must reconcile listeners, pending work, and transient state for inserted or removed descendants.
Unchanged regions skip that callback. Replaced regions run disposal and initialization instead.
The callback preserves top-level ownership and follows the same error and reentrancy rules as initialization.

The copy initializer still returns a callable cleanup function. Its new `refresh()` method cancels pending feedback and restores current button labels.
Late clipboard completions cannot modify refreshed controls. A user-requested clipboard write itself cannot be canceled after it starts.
Retained copy buttons read the current code on each click.

`patchChildren: false` disables ordinary descendant patches.
The separate code cache can still retain code nodes and patch their syntax when explicitly enabled.

## Scoped initialization

```typescript
import { createMarkdownView } from "@lpm.dev/neo.markdown/dom";
import { initializeCopyCode } from "@lpm.dev/neo.markdown/plugins/copy-code";
import { initializeEmbeds } from "@lpm.dev/neo.markdown/plugins/embeds";

const root = document.createElement("div");
document.body.append(root);
const view = createMarkdownView(root, {
  initialize(region) {
    const stopCopy = initializeCopyCode({ root: region });
    try {
      const stopEmbeds = initializeEmbeds({ root: region });
      return () => { stopEmbeds(); stopCopy(); };
    } catch (error) {
      stopCopy();
      throw error;
    }
  },
});
try {
  view.update("<p>Ready for document HTML.</p>");
} finally {
  view.dispose();
  root.remove();
}
```

`initialize` runs once for each inserted top-level element, after insertion into the root.
Text nodes and comments need no initialization.
The callback returns a cleanup function, a lifecycle object, or `undefined`.
Retained regions keep their existing callback state.
Complete-replacement fallback initializes the whole root as one scope.

Cleanup runs before region removal. All known cleanup functions run even if one throws.
An initializer that throws before returning must release its own partial setup.
Same-view reentrancy and disposal during initialization prevent an accepted update.
During patch updates, initializers and cleanup functions must preserve top-level ownership.
Lifecycle errors close the view and clear its DOM. They never trigger an automatic replacement retry.
A later explicit application action can create a new view.

The embed initializer supports a root that is itself a Gist or tweet region.
Mounted tweet scopes share one loader script and own separate load listeners.
Disposal removes a scope's pending listener. It leaves the shared loader script available to other scopes.
Third-party code remains responsible for any state that it stores outside the supplied scope.

## Bounds and fallback

| Option | Default | Scope |
| --- | ---: | --- |
| `maxCodeBlockHtmlLength` | 0 | Combined UTF-16 units in complete input HTML and surrounding-container snapshot strings. Zero disables the separate code cache. |
| `maxCachedHtmlLength` | 2,000,000 | Combined UTF-16 units in the input, canonical region keys, and nested snapshot strings. Also limits input sent to template parsing. |
| `maxNodes` | 50,000 | Canonical nodes per update, including reused regions, text, and comments. |
| `maxRegions` | 4,096 | Retained top-level regions. |
| `maxDepth` | 128 | Inspected nesting depth. |

All limits require non-negative safe integers.
Each cache declines updates that exceed its limits.
If neither cache accepts the update, the view replaces its content and retains no patch snapshots.
Later smaller output can use patches again.
These limits bound additional patch matching and retained state, not the final browser DOM or arbitrary initializer work.
Template parsing can allocate nodes before inspection reaches its limit.
Applications still need finite parser and output limits for their complete documents.

Scripts, styles, templates, foreign namespaces, custom elements, customized built-ins, and event-handler attributes select complete replacement.
Forms, other special parsing elements, and top-level table fragments also select replacement.
Form markup depends on the root's ancestors, so it cannot use the inert template's parsing context.
Unsupported template contents stay inert and never enter the live document.
Fallback assigns the original string through ordinary `innerHTML`, preserving its parsing and script-insertion behavior.
It does not sanitize otherwise unsafe content.

`update()` returns `mode`, optional fallback `reason`, and counts of reused, removed, and inserted regions.
`patchedRegions` counts changed top-level regions patched in place. The field is absent when that count is zero.
Modes are `unchanged`, `patch`, and `replace`.
Reasons are `html-limit`, `node-limit`, `region-limit`, `depth-limit`, `unsupported-html`, and `external-mutation`.
`metrics` adds successful update counts and current retained region, snapshot-node, and HTML-unit counts.
`cachedNodes` is zero after fallback or disposal, and when `patchChildren` is disabled.
Reports are detached copies. These counters measure regions and strings, not CPU time or exact heap bytes.

## React ownership

The Markdown demo gives the view a `div` with no React-managed children or `dangerouslySetInnerHTML` prop.
Layout effects create, update, and dispose the view after commits.
React owns the root attributes and the surrounding result assets. The view owns the root's children.
The server and initial client render use the same empty pending shell.

Configuration changes and parser errors clear the HTML through the normal session flow.
Pending source edits retain the last preview with a busy status.
A DOM initialization failure clears the preview and exposes an explicit retry control.
That control retries DOM initialization without repeating parser callbacks.
Unmount and StrictMode cleanup dispose the currently owned view, including any replacement created during recovery.
The demo declares update hooks for copy-code and ordinary content scopes. Embed scopes keep complete replacement.

The ordinary patch path still requires complete HTML generation and template parsing for changed strings.
Snapshot construction and comparison add work. Small documents and complete replacements can remain slower than top-level replacement.
Measure mounted application workloads before adopting the DOM view.

## Optional code-block staging

`maxCodeBlockHtmlLength` enables a separate bounded cache for code blocks and their surrounding containers.
Its default is zero, which disables this path.
The option can reduce fragment parsing and DOM replacement during highlighted streams and edits across multiple blocks.
It requires a DOM `MutationObserver` and no `initialize` callback.

```ts
const view = createMarkdownView(root, {
  patchChildren: true,
  maxCachedHtmlLength: 32_000,
  maxCodeBlockHtmlLength: 2_000_000,
})
```

The initial update records each code block's syntax nodes and offsets relative to its code body.
The cache records surrounding markup separately, with code bodies represented by empty leaves.
If surrounding markup changes, the view stages that markup without parsing or indexing unchanged syntax again.
If surrounding markup stays equal, the view skips that staging step.
Changed code bodies retain matching prefix and suffix nodes. Only their changed middle needs an inert template.

The cache accepts canonical HTML `pre` and `code` containers with text and nested `span` descendants.
Its supported text encodings include ordinary HTML escapes and the highlighter's quote escapes.
Each staged syntax node must match the supplied HTML under those encoding rules before insertion.
The surrounding markup must also pass the ordinary element policy.

Unchanged code blocks can keep their nodes through insertion, removal, reordering, and changes to their parent containers.
Matching first preserves equal prefixes and suffixes, then pairs exact content, then pairs remaining candidates in order.
Changed code opening attributes require a new code node.
Duplicate code bodies have no unique identity guarantee.
Moving a retained node can affect browser-managed focus or selection; applications must test their own interaction requirements.

With `patchChildren: true`, compatible surrounding containers also receive patches in place.
With `patchChildren: false`, changed ordinary containers receive replacement, but their matched code nodes can still survive.
If an initializer is registered, neither setting permits this cache.

The complete input HTML must already satisfy the application's sanitizer and trust policy.
The code cache neither sanitizes fragments nor interprets Markdown source boundaries.
Unsupported markup or encodings use the ordinary update path.
All container and syntax plans pass validation before the view changes live nodes.
The node, depth, and top-level region limits apply across the complete document, including reused content.
A rejected plan does not repeat code indexing during its immediate fallback update.

The HTML limit covers the complete input and surrounding snapshot strings.
Node limits also bound retained syntax entries and temporary matching collections.
The cache retains one current revision. It does not retain an HTML history.
Template parsing can allocate nodes before the node check, as with the ordinary path.

Descendant changes outside the view invalidate the cache and trigger complete replacement.
The application retains ownership of root `div` attributes, including status and accessibility attributes.
Those root attribute changes do not invalidate code content.

`cachedCodeBlockHtmlCodeUnits` reports retained input units.
`cachedCodeBlockNodes` counts code syntax and its `pre` and `code` elements.
These counters exclude surrounding snapshot strings and nodes, which still count toward their respective limits.
Disposal disconnects the observer and releases all retained strings and node references.
