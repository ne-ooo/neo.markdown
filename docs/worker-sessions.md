# Markdown worker sessions

Stable imports and legacy aliases follow the [API stability contract](./api-stability.md).

The optional worker entries move parsing, highlighting, and sanitization into an application-owned worker.
Each worker owns one incremental Markdown session. The client returns complete HTML, stylesheet assets, diagnostics, and TOC data.
Existing `parse()`, `parseDocument()`, and synchronous incremental APIs keep their behavior.
These APIs are stable in version 3.0 and require Node 22.12 or later for Node consumers.

## Worker configuration

Functions, plugins, grammars, and sanitizer providers belong inside the worker entry.
The configuration contains finite JSON data only: primitives, dense arrays, and plain objects.
The transport copies and freezes this data. It rejects functions, accessors, cycles, symbols, and custom object prototypes.
Configuration limits are 1,024 values, 16 nesting levels, and 16,384 UTF-16 units across strings and property names.
These limits bound the copied graph. Enumeration of caller-owned object keys still costs time and memory.

```ts
// markdown.worker.ts
import { installMarkdownWorker } from '@lpm.dev/neo.markdown/worker'
import { sanitizeHtml } from '@lpm.dev/neo.markdown/sanitized'

installMarkdownWorker(self, {
  configure(configuration) {
    if (configuration !== null) throw new TypeError('Unknown configuration')
    return {
      session: {
        parser: { gfm: true, allowHtml: true, sanitize: true, sanitizer: sanitizeHtml },
      },
    }
  },
})
```

The factory returns `{ session?, document? }` synchronously.
`session` accepts `IncrementalMarkdownOptions`. `document` accepts `DocumentOptions` for each update.
Application toggles require checks inside this factory. Configuration changes require a new client and worker.
A rejected configuration closes the worker session.

Highlighting uses the existing highlight or presentation plugin inside the factory.
Its tokenizer, grammars, renderer, theme, and stylesheet provider stay in that worker.
DOM style injection must remain disabled. The result carries stylesheet assets for the application to install.
DOM initialization for copying and embeds remains on the main thread.

Declared plugin reuse keeps the existing purity and invalidation contract.
The worker entry shares the incremental runtime through a package import.
Plugin declarations and the worker handler must use the same module format and package instance.
Undeclared plugins, including custom embed blocks, retain complete parsing on every update.
Render callbacks and sanitization still run for each processed update. The worker does not make impure callbacks reusable.
See [incremental documents](./incremental.md) for registration checks and invalidation rules.

## Client ownership

```ts
import {
  createMarkdownWorkerClient,
  MarkdownWorkerError,
} from '@lpm.dev/neo.markdown/worker-client'

const client = createMarkdownWorkerClient({
  createWorker: () => new Worker(new URL('./markdown.worker.ts', import.meta.url), {
    type: 'module',
  }),
  timeoutMs: 5_000,
})

async function updatePreview(source: string) {
  try {
    const update = await client.update(source)
    // Commit only while this editor still owns the client and configuration.
    renderDocument(update.result)
  } catch (error) {
    if (error instanceof MarkdownWorkerError && error.code === 'SUPERSEDED') return
    showPreviewError(error)
  }
}

// Component cleanup or document replacement:
client.dispose()
```

The factory must return a fresh, exclusively owned worker. The client creates it lazily after the first accepted update.
`update()` accepts complete source, including the accumulated prefix of a stream.
The client retains one active request and one queued request. Each accepted edit replaces queued source and rejects earlier promises with `SUPERSEDED`.
The active parse continues until its response or deadline. This preserves incremental state between rapid edits.
The client discards superseded results without copying their document graph again.
Queued requests that lose their place never run callbacks.

Accepted updates receive increasing revisions. Request identifiers and worker identity prevent stale results from completing newer requests.
Returned results and metrics are immutable snapshots.
The application must still guard its own asynchronous work and configuration changes before DOM updates.
An idle worker terminates after 30 seconds. `idleTimeoutMs: 0` disables idle termination.
`dispose()` rejects pending updates and releases the worker, listeners, timers, configuration, and factory.
A disposed client cannot restart.

## Cancellation and recovery

`update(source, { signal, timeoutMs })` accepts an `AbortSignal` and a deadline override.
The deadline includes queue wait, worker startup, processing, and message delivery.
Worker startup also has a fixed deadline from its initial request. Later edits cannot keep an unresponsive startup alive indefinitely.

An active abort or timeout terminates the worker. A queued abort removes only that queued request.
After supersession, the old signal detaches. The active computation keeps its original deadline.
Client disposal always terminates active computation.
A separately queued newer request can start in a fresh worker after active termination.
The interrupted revision never runs again automatically.

Worker crashes, message errors, and malformed responses reject pending updates and terminate that worker.
A later edit can start a fresh worker. The application can also offer an explicit refresh action.
A callback or resource-limit failure releases parser state inside the worker before a later update.
A worker is a concurrency boundary, not a security sandbox for untrusted plugin code.

`MarkdownWorkerError.code` distinguishes these outcomes:

| Codes | Meaning |
| --- | --- |
| `SUPERSEDED`, `ABORTED`, `DISPOSED` | A newer edit, cancellation, or cleanup ended the request. |
| `TIMEOUT` | The request or initial worker startup exceeded its deadline. |
| `QUEUE_FULL`, `INPUT_LIMIT` | Source exceeded a client or worker limit. |
| `WORK_LIMIT`, `OUTPUT_LIMIT` | Incremental work or transported output exceeded a limit. |
| `CONFIGURATION_ERROR`, `PROTOCOL_ERROR`, `WORKER_ERROR` | Configuration, message checks, or the transport failed. |
| `RENDER_ERROR` | Parser setup, callbacks, rendering, sanitization, or document collection failed. |

Document collection retains its existing error behavior. Its own limit errors can appear as `RENDER_ERROR` with `remoteName: 'RangeError'`.
Arbitrary callback errors do not become resource-limit errors based on their messages.

The demo selects a synchronous fallback only if `Worker` is unavailable before initialization.
A startup or runtime worker failure stops that attempt. It does not automatically repeat callbacks on the main thread.
Configuration changes hide previous results. Oversized input clears preview state and terminates the worker while preserving editor text.
Unmount and explicit refresh dispose the previous owner. Editing supersedes requests without aborting the worker after every keystroke.

## Resource limits and measurements

Both client and worker accept `limits`. Worker ceilings and client ceilings combine by minimum.
The default limits are finite:

| Limit | Default |
| --- | ---: |
| `maxInputLength` | 250,000 UTF-16 units |
| `maxResultCodeUnits` | 2,000,000 combined result string units |
| `maxStylesheets` | 64 |
| `maxDiagnostics` | 1,000 |
| `maxTocEntries` | 10,000 |
| Client `maxPendingCodeUnits` | 500,000 source units across active and queued requests |
| Worker `maxUpdates` | 1,000 updates per parser session |
| Worker `maxWorkCodeUnits` | 16,000,000 charged work units per parser session |

The handler rotates parser sessions between updates at the update ceiling or 75% of the work ceiling.
It also rotates before an update whose initial source charge exceeds remaining work.
A single update can still exceed its work ceiling. Rotation does not repeat an interrupted callback.
Session configuration can lower these ceilings. Document configuration can lower collection ceilings.
Finite counters bound retained parser state and transported results. They cannot bound arbitrary plugin allocation or execution inside one callback.
Worker termination provides the interruption mechanism for blocking callbacks.

Each update returns `revision`, `result`, `metrics`, `roundTripMs`, and `totalMs`.
Worker metrics include processing time, session generations, rotations, source length, charged work, and parsed or reused block and inline units.
`totalMs` includes queue wait and startup. `roundTripMs` starts immediately before the update message is posted.
The difference between round trip and worker processing includes message cloning, scheduling, and client result checks.
It is not a direct serialization measurement.
Client metrics expose worker starts, completed updates, superseded updates, and pending source counts.

Updates still transfer complete source and complete results. HTML staging, DOM patches, style installation, and browser layout remain on the main thread.
Small documents can cost more because of worker startup and message delivery.
Application measurements must separate startup, warm updates, worker processing, message overhead, and DOM work.
HTML deltas and shared workers remain separate work.
See [application ownership](./application-adapter.md) for the reusable adapter and React hook.

For custom transports, `createMarkdownWorkerHandler()` exposes `handle()` and `dispose()` without global listeners.
`installMarkdownWorker()` returns a cleanup function. Both entries are safe to import without worker or DOM globals.
Node consumers can adapt `worker_threads` events to the exported transport interfaces.

## Optional HTML delta transport

`htmlDeltas: true` enables capability negotiation on the worker client and application adapter.
The default remains `false`. An older worker that does not acknowledge the capability continues to return full results.
The public result still contains the complete `html` string, stylesheets, diagnostics, and TOC.

```ts
const client = createMarkdownWorkerClient({
  createWorker: () => new Worker(new URL('./markdown.worker.ts', import.meta.url), { type: 'module' }),
  htmlDeltas: true,
})
```

Rendering, callbacks, plugin invalidation, and whole-document sanitization still run for each processed update.
The worker compares the two final HTML strings after those operations.
It sends one replacement range only when that payload is smaller than the complete HTML payload.
This transport optimization does not reuse render callbacks or sanitize fragments independently.

The worker retains one previous HTML string within `maxResultCodeUnits`.
The client retains one acknowledged HTML base within the same bound.
Updates identify the acknowledged base revision. Delta responses contain `start`, `deleteCount`, and `insert` in UTF-16 code units.
The client checks the base revision, range, and reconstructed length before allocation and result validation.
Stylesheet and diagnostic limits also apply to the reconstructed result.
A delta can split a surrogate pair during transport. String reconstruction preserves the exact complete HTML.

Superseded responses do not replace the acknowledged base or copy their document graph.
A missing or mismatched worker base causes a full response on the next update.
An unexpected response base is a protocol error and releases the worker.
Errors clear the retained transport base. Retirement, disposal, and restart also release it.
Parser session rotation still produces complete final HTML before delta comparison.

Custom transports use the optional `htmlDeltas` field in `open` and `ready` messages.
An acknowledged update can contain `htmlBaseRevision`.
A negotiated `html-delta` response contains the complete non-HTML result fields and its delta, request id, revision, and metrics.
The existing `result` response remains valid after negotiation and acts as a new base.
