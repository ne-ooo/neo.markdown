# Application document ownership

The application adapter owns one document session and its pending work.
It supports dedicated workers and synchronous fallbacks with the same result shape.
`application` contains no parser, sanitizer, React, or DOM runtime dependencies.
`application/sync` supplies a bounded synchronous backend. `application/react` supplies the React hook.
These entries are stable in version 3.0. See [API stability](./api-stability.md) for compatibility rules.

## Framework-neutral use

```ts
import { createMarkdownApplication, MarkdownApplicationError } from '@lpm.dev/neo.markdown/application'
import { createMarkdownView } from '@lpm.dev/neo.markdown/dom'

const owner = createMarkdownApplication({
  createWorker: () => new Worker(new URL('./markdown.worker.ts', import.meta.url), {
    type: 'module',
  }),
  configuration: { mode: 'documentation' },
})
const view = createMarkdownView(document.querySelector<HTMLDivElement>('#preview')!)

async function preview(source: string) {
  try {
    const outcome = await owner.update(source)
    if (!owner.isCurrent(outcome)) return
    if (outcome.status === 'ready') {
      // Apply stylesheet assets, diagnostics, and TOC data from the same result.
      view.update(outcome.result.html)
    } else {
      view.update('')
      showPreviewError(outcome.error)
    }
  } catch (error) {
    if (error instanceof MarkdownApplicationError && error.code === 'SUPERSEDED') return
    showPreviewError(error)
  }
}

// Explicit recovery starts a new backend on the next update.
owner.reset()
void preview(editor.value)

// Route or editor cleanup:
owner.dispose()
view.dispose()
```

The worker entry configures the parser, plugins, and sanitizer.
See [worker sessions](./worker-sessions.md) for an entry example and configuration checks.
The adapter passes an immutable JSON configuration snapshot to the worker or fallback factory.
Construction does not run either factory or create a parser.
Configuration changes require a new owner. Owners cannot share workers or mutable parser sessions.

`update()` accepts complete source and returns a promise for an immutable outcome wrapper.
A stream supplies its accumulated source, including prefixes that replace skipped chunks.
Accepted updates have increasing revisions. `isCurrent()` checks outcome identity and ownership.
New accepted updates, reset, and disposal invalidate earlier outcomes.
Applications must repeat the ownership check after other asynchronous work and before a DOM commit.

| Outcome | Meaning |
| --- | --- |
| `ready` | `result` contains HTML, stylesheet assets, diagnostics, and TOC data. |
| `input-limit` | Source exceeded the application or backend input ceiling. |
| `work-limit` | The incremental parser exceeded its cumulative work allowance. |
| `error` | Setup, processing, output limits, queue limits, or a deadline failed. |

Each outcome includes `revision`. Failure outcomes include `error`.
Worker errors become `MarkdownApplicationError` instances with a stable `code` and the original error as `cause`.
Synchronous callback errors retain their identity. Ordinary `RangeError` values do not become limit errors based on message text.
`SUPERSEDED`, `ABORTED`, and `DISPOSED` reject the promise instead of producing displayable error outcomes.
Invalid API arguments can reject with `TypeError` or `RangeError`.
An error outcome does not trigger an automatic retry. A later edit or explicit reset can start another attempt.

## Workers and fallbacks

`createWorker` selects worker mode. `createFallback` applies only without `createWorker`.
A worker startup or runtime error never switches modes automatically.
This prevents callbacks from running again in a different runtime after a failed attempt.

```ts
import { createMarkdownApplication } from '@lpm.dev/neo.markdown/application'

const owner = createMarkdownApplication({
  createWorker: typeof Worker === 'undefined' ? undefined
    : () => new Worker(new URL('./markdown.worker.ts', import.meta.url), { type: 'module' }),
  createFallback: async (_configuration, signal) => {
    const { createMarkdownSynchronousSession } = await import('@lpm.dev/neo.markdown/application/sync')
    if (signal.aborted) throw new Error('Fallback setup was cancelled')
    return createMarkdownSynchronousSession({ parser: { gfm: true } })
  },
})
```

The fallback factory returns a fresh session with synchronous `update(source)` and `dispose()` methods.
Its update returns a `DocumentResult`. The adapter copies and freezes custom fallback results before exposing them.
Asynchronous update methods are unsupported. The worker client is the asynchronous processing backend.

The factory can load code asynchronously. Only the latest pending source remains eligible during setup.
The adapter passes an `AbortSignal` to abandoned setup and disposes sessions that arrive after cancellation.
Custom asynchronous factories must cooperate with that signal. The adapter cannot forcibly stop arbitrary promises or external factory side effects.
The default fallback does not interrupt a synchronous callback. A late result after its deadline is discarded.

`createMarkdownSynchronousSession()` accepts incremental parser options and an optional `document` property for document collection limits.
Its default limits are 250,000 source units, 1,000 updates, and 16,000,000 cumulative work units.
The backend rotates parser sessions between updates, using the same work threshold as the worker handler.
It never retries an interrupted callback. Its `dispose()` method releases parser state.
The document collector retains finite ceilings for stylesheets, diagnostics, and TOC entries.
Custom callbacks remain responsible for their own allocation and execution costs.

## React use

```tsx
import { useMemo } from 'react'
import { useMarkdownDocument } from '@lpm.dev/neo.markdown/application/react'

export function MarkdownPreview({ source }: { source: string }) {
  const options = useMemo(() => ({
    createWorker: () => new Worker(new URL('./markdown.worker.ts', import.meta.url), {
      type: 'module' as const,
    }),
  }), [])
  const preview = useMarkdownDocument(source, options)
  const result = preview.status === 'ready' || preview.status === 'pending'
    ? preview.result : undefined

  return <>
    {preview.status === 'error' && <button onClick={preview.refresh}>Refresh preview</button>}
    {/* A view component owns DOM initialization, patches, and scoped cleanup. */}
    <DocumentView result={result} pending={preview.status === 'pending'} />
  </>
}
```

The hook creates ownership in an effect. Server rendering and the first client render produce a pending result without parser work.
Source edits retain the last complete preview while pending. Configuration changes hide earlier output immediately.
Errors clear result data. The `refresh()` method replaces the owner and performs one attempt with the current source.
Unmount and configuration changes dispose the owner, including during StrictMode effect replay.
Stable options identity prevents unnecessary worker restarts. Parser configuration belongs outside React rendering or inside the fallback factory.

The hook does not create DOM nodes, install stylesheets, or initialize copy and embed controls.
The application owns those actions through its view component.
See [DOM patches](./dom-patches.md) for React ownership and initializer cleanup.
For server-rendered document HTML, applications can retain `parseDocument()` and their existing hydration strategy.
The hook's pending shell does not hydrate previously rendered document HTML automatically.
React remains an optional peer dependency. The framework-neutral entry does not import it.

## Deadlines, cleanup, and limits

`update(source, { signal, timeoutMs })` accepts cancellation and a per-call deadline.
The default deadline is 5,000 ms. It includes queue wait, startup, processing, and result delivery.
Initial fallback setup has a fixed deadline from its first request. Newer edits cannot extend that deadline indefinitely.

Worker mode retains one active computation and one latest queued source through the worker client.
Supersession rejects previous application promises while preserving active worker computation and its deadline.
Synchronous mode coalesces queued edits before a parse or during asynchronous setup.
Aborting the current application request releases its backend, including older superseded worker computation.
Timeouts, reset, input and queue limits, and disposal also release backend state.
The lower-level worker client retains its separate queued-abort behavior.

`reset()` rejects pending requests with `ABORTED` and retains configuration for the next update.
`dispose()` rejects pending requests with `DISPOSED`, releases factories and configuration, and permanently closes the owner.
Both cleanup methods are idempotent. Custom disposal errors cannot prevent promise settlement or remaining cleanup.
Oversized source remains in the application's editor, not in the adapter's pending state.
A shorter subsequent edit can create a fresh backend.

The adapter accepts the worker client's finite `limits`, `maxPendingCodeUnits`, and `idleTimeoutMs` options.
Default limits include 250,000 source units, 2,000,000 combined result string units, and 500,000 pending source units.
Default result entry limits are 64 stylesheets, 1,000 diagnostics, and 10,000 TOC entries.
An idle backend retires after 30 seconds. `idleTimeoutMs: 0` disables idle retirement.
Idle retirement preserves the current result and its ownership check.

`metrics` returns a snapshot with mode, backend generations, accepted updates, pending status, and disposal status.
Worker mode also includes the worker client's counters. Parser rotations and worker starts can occur inside one application generation.
Metric values describe the implementation and workload. They are not performance guarantees.
DOM and layout costs remain on the application thread.

The application adapter accepts `htmlDeltas: true` to negotiate smaller worker responses.
Its result shape, revision checks, cancellation, recovery, and fallback behavior remain unchanged.
See [worker sessions](./worker-sessions.md#optional-html-delta-transport) for the retained-base limits and compatibility rules.
The DOM view separately supports [optional code-block staging](./dom-patches.md#optional-code-block-staging).
Both optimizations require explicit options and preserve complete final document results.
