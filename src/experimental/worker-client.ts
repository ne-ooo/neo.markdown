import type { DocumentResult } from '../core/types.js'
import {
  MARKDOWN_WORKER_PROTOCOL as protocol, MarkdownWorkerError, integer, record, readLimits, copyConfiguration, copyResult, copyMetrics, applyHtmlDelta,
  type MarkdownWorkerConfiguration, type MarkdownWorkerLimits, type MarkdownWorkerRequest, type MarkdownWorkerMetrics,
} from './worker/protocol.js'
export { MarkdownWorkerError } from './worker/protocol.js'
export type { MarkdownWorkerConfiguration, MarkdownWorkerLimits, MarkdownWorkerRequest, MarkdownWorkerResponse, MarkdownWorkerMetrics, MarkdownWorkerErrorCode } from './worker/protocol.js'

export interface MarkdownWorkerTransport {
  postMessage(message: MarkdownWorkerRequest): void
  terminate(): void | Promise<unknown>
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void
  addEventListener(type: 'error' | 'messageerror', listener: (event: Event) => void): void
  removeEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void
  removeEventListener(type: 'error' | 'messageerror', listener: (event: Event) => void): void
}
export interface MarkdownWorkerClientOptions {
  /** Return a fresh, exclusively owned worker. Creation is lazy. */
  createWorker: () => MarkdownWorkerTransport
  /** Immutable JSON data for the worker-local configuration factory. */
  configuration?: MarkdownWorkerConfiguration
  /** Negotiate bounded HTML deltas. Returned document results still contain complete HTML. Default: false. */
  htmlDeltas?: boolean
  limits?: Partial<MarkdownWorkerLimits>
  /** Includes queue wait and worker startup. Default: 5,000 ms. */
  timeoutMs?: number
  /** Terminate an idle worker after this interval. Zero disables idle retirement. Default: 30,000 ms. */
  idleTimeoutMs?: number
  /** Source units in the active request and latest queued request. Default: 500,000. */
  maxPendingCodeUnits?: number
}
export interface MarkdownWorkerCallOptions { signal?: AbortSignal; timeoutMs?: number }
export interface MarkdownWorkerUpdate {
  readonly revision: number
  readonly result: DocumentResult
  readonly metrics: Readonly<MarkdownWorkerMetrics>
  /** Includes message scheduling and cloning, but excludes queue wait and worker startup. */
  readonly roundTripMs: number
  /** Includes queue wait and worker startup. */
  readonly totalMs: number
}
export interface MarkdownWorkerClient {
  /** Submit complete source. New accepted edits supersede older promises and replace queued source. */
  update(source: string, options?: MarkdownWorkerCallOptions): Promise<MarkdownWorkerUpdate>
  dispose(): void
  readonly metrics: {
    workerStarts: number; completedUpdates: number; supersededUpdates: number
    pendingCount: number; pendingCodeUnits: number; activeRevision?: number; queuedRevision?: number
  }
}
interface Pending {
  source: string; units: number; revision: number; id?: number; created: number; sent?: number; deadline: number
  timer?: ReturnType<typeof setTimeout>; signal?: AbortSignal; abort?: () => void; settled: boolean
  resolve?: (update: MarkdownWorkerUpdate) => void; reject?: (error: unknown) => void
}
interface Binding {
  htmlDeltas?: boolean; base?: { revision: number; html: string }
  worker: MarkdownWorkerTransport; openId: number; ready: boolean; timer?: ReturnType<typeof setTimeout>
  message: (event: MessageEvent<unknown>) => void; failure: (event: Event) => void
}
const timeout = (value: number) => integer(value, 'timeoutMs', 1, 2_147_483_647)

/** One physical request and one latest queued revision. Superseding an edit preserves warm worker state. */
export function createMarkdownWorkerClient(options: MarkdownWorkerClientOptions): MarkdownWorkerClient {
  if (typeof options?.createWorker !== 'function') throw new TypeError('createWorker must be a function')
  let factory: (() => MarkdownWorkerTransport) | undefined = options.createWorker
  let configuration: MarkdownWorkerConfiguration | undefined = copyConfiguration(options.configuration ?? null)
  const htmlDeltas = options.htmlDeltas ?? false
  if (typeof htmlDeltas !== 'boolean') throw new TypeError('htmlDeltas must be a boolean')
  const localLimits = readLimits(options.limits)
  const defaultTimeout = timeout(options.timeoutMs ?? 5000)
  const idleMs = integer(options.idleTimeoutMs ?? 30_000, 'idleTimeoutMs', 0, 2_147_483_647)
  const maxPending = integer(options.maxPendingCodeUnits ?? 500_000, 'maxPendingCodeUnits')
  let limits = localLimits, binding: Binding | undefined, active: Pending | undefined, queued: Pending | undefined
  let idle: ReturnType<typeof setTimeout> | undefined, scheduled = false, disposed = false
  let sequence = 0, revision = 0, workerStarts = 0, completedUpdates = 0, supersededUpdates = 0
  const retired = new WeakSet<MarkdownWorkerTransport>()
  function nextId() { if (sequence >= Number.MAX_SAFE_INTEGER) throw new RangeError('Worker request id limit reached'); return ++sequence }
  function clearIdle() { if (idle !== undefined) clearTimeout(idle); idle = undefined }
  function stop(worker: MarkdownWorkerTransport) {
    retired.add(worker)
    try { Promise.resolve(worker.terminate()).catch(() => {}) } catch { /* Transport teardown is best effort. */ }
  }
  function retire() {
    clearIdle()
    const old = binding; binding = undefined; limits = localLimits
    if (!old) return
    if (old.timer !== undefined) clearTimeout(old.timer)
    for (const type of ['message', 'error', 'messageerror'] as const) {
      try {
        if (type === 'message') old.worker.removeEventListener(type, old.message)
        else old.worker.removeEventListener(type, old.failure)
      } catch { /* A teardown failure cannot leave promises pending. */ }
    }
    stop(old.worker)
  }
  function detachSignal(task: Pending) {
    try { if (task.abort) task.signal?.removeEventListener('abort', task.abort) } catch { /* Continue settlement. */ }
    task.signal = undefined; task.abort = undefined
  }
  function settle(task: Pending, error?: unknown, update?: MarkdownWorkerUpdate) {
    if (task.settled) return
    task.settled = true; detachSignal(task)
    const resolve = task.resolve, reject = task.reject; task.resolve = undefined; task.reject = undefined
    if (update) resolve?.(update); else reject?.(error)
  }
  function release(task: Pending) {
    if (active === task) active = undefined
    if (queued === task) queued = undefined
    if (task.timer !== undefined) clearTimeout(task.timer)
    task.timer = undefined; task.source = ''; detachSignal(task)
  }
  function schedule() {
    if (scheduled || disposed) return
    scheduled = true
    queueMicrotask(() => { scheduled = false; pump() })
  }
  function fail(error: MarkdownWorkerError) {
    retire()
    for (const task of [active, queued]) if (task) { release(task); settle(task, error) }
  }
  function cancel(task: Pending, error: MarkdownWorkerError) {
    if (active !== task && queued !== task) return
    if (active === task) retire()
    release(task); settle(task, error)
    if (!active && !queued && binding && !binding.ready) retire()
    schedule()
  }
  function expired(task: Pending) {
    if (performance.now() < task.deadline) return false
    cancel(task, new MarkdownWorkerError('TIMEOUT', 'Markdown update exceeded its deadline')); return true
  }
  function receive(current: Binding, event: MessageEvent<unknown>) {
    if (binding !== current || disposed) return
    try {
      const data = record(event.data)
      if (data.protocol !== protocol) throw new TypeError('Invalid worker protocol')
      const expectedId = current.ready ? active?.id : current.openId
      // Late duplicate replies cannot finish a newer revision or a new worker generation.
      integer(data.id as number, 'response id', 1, sequence)
      if (data.id !== expectedId) return
      if (!current.ready) {
        if (data.type === 'error') {
          const error = record(data.error)
          if (!['CONFIGURATION_ERROR', 'PROTOCOL_ERROR'].includes(error.code as string) || typeof error.message !== 'string' || typeof error.name !== 'string') throw new TypeError('Invalid configuration error')
          fail(new MarkdownWorkerError(error.code as 'CONFIGURATION_ERROR' | 'PROTOCOL_ERROR', error.message.slice(0, 1000), error.name.slice(0, 100))); return
        }
        if (data.type !== 'ready') throw new TypeError('Worker did not acknowledge configuration')
        const remote = readLimits(record(data.limits), true)
        limits = { ...localLimits }
        for (const key of Object.keys(limits) as (keyof MarkdownWorkerLimits)[]) limits[key] = Math.min(limits[key], remote[key])
        if (data.htmlDeltas !== undefined && typeof data.htmlDeltas !== 'boolean' || data.htmlDeltas === true && !htmlDeltas) throw new TypeError('Invalid HTML delta negotiation')
        current.htmlDeltas = htmlDeltas && data.htmlDeltas === true
        current.ready = true
        if (current.timer !== undefined) clearTimeout(current.timer)
        current.timer = undefined; schedule(); return
      }
      const task = active
      if (!task || expired(task)) return
      if (data.revision !== task.revision || data.type !== 'result' && data.type !== 'error' && !(data.type === 'html-delta' && current.htmlDeltas)) throw new TypeError('Worker returned an invalid revision')
      if (data.type === 'error') {
        current.base = undefined
        const error = record(data.error)
        const codes = ['INPUT_LIMIT', 'WORK_LIMIT', 'OUTPUT_LIMIT', 'RENDER_ERROR', 'PROTOCOL_ERROR'] as const
        if (typeof error.code !== 'string' || !codes.includes(error.code as typeof codes[number]) || typeof error.name !== 'string' || typeof error.message !== 'string') throw new TypeError('Invalid worker error')
        const failure = new MarkdownWorkerError(error.code as typeof codes[number], error.message.slice(0, 1000), error.name.slice(0, 100))
        if (failure.code === 'PROTOCOL_ERROR') { fail(failure); return }
        release(task); settle(task, failure)
      } else {
        // Superseded output is drained without copying its document graph on the main thread.
        if (!task.settled) {
          const document = data.type === 'html-delta'
            ? { ...record(data.result), html: applyHtmlDelta(data.delta, current.base, limits.maxResultCodeUnits) }
            : data.result
          const result = copyResult(document, limits), metrics = copyMetrics(data.metrics)
          if (metrics.sourceLength !== task.units) throw new TypeError('Worker returned an invalid source length')
          const now = performance.now()
          if (expired(task)) return
          if (current.htmlDeltas) current.base = { revision: task.revision, html: result.html }
          const update = Object.freeze({ revision: task.revision, result, metrics, roundTripMs: now - task.sent!, totalMs: now - task.created })
          release(task); completedUpdates++; settle(task, undefined, update)
        } else release(task)
      }
      schedule()
    } catch (error) { fail(error instanceof MarkdownWorkerError ? error : new MarkdownWorkerError('PROTOCOL_ERROR', 'Worker returned an invalid Markdown response')) }
  }
  function connect() {
    const openId = nextId(), worker = factory!()
    if (!worker || (typeof worker !== 'object' && typeof worker !== 'function') || retired.has(worker)) throw new TypeError('createWorker must return a fresh worker')
    if (['postMessage', 'terminate', 'addEventListener', 'removeEventListener'].some(key => typeof worker[key as keyof MarkdownWorkerTransport] !== 'function')) {
      stop(worker); throw new TypeError('createWorker must return a worker transport')
    }
    const current: Binding = { worker, openId, ready: false,
      message: event => receive(current, event),
      failure: () => { if (binding === current) fail(new MarkdownWorkerError('WORKER_ERROR', 'Markdown worker failed')) },
    }
    binding = current; workerStarts++
    if (disposed) { retire(); return }
    try {
      worker.addEventListener('message', current.message)
      if (binding !== current) return
      worker.addEventListener('error', current.failure)
      if (binding !== current) return
      worker.addEventListener('messageerror', current.failure)
      if (binding !== current) return
      const startupMs = Math.max(1, (queued?.deadline ?? performance.now() + defaultTimeout) - performance.now())
      current.timer = setTimeout(() => { if (binding === current && !current.ready) fail(new MarkdownWorkerError('TIMEOUT', 'Markdown worker startup exceeded its deadline')) }, startupMs)
      worker.postMessage({ protocol, type: 'open', id: current.openId, configuration: configuration!, limits: { ...localLimits }, ...(htmlDeltas ? { htmlDeltas: true } : {}) })
    } catch (error) { retire(); throw error }
  }
  function pump() {
    if (disposed || active) return
    if (!queued) {
      if (binding?.ready && idleMs && idle === undefined) idle = setTimeout(() => { if (!active && !queued) retire() }, idleMs)
      return
    }
    if (expired(queued)) return
    clearIdle()
    try {
      if (!binding) connect()
      if (!binding?.ready || !queued || disposed) return
      const task = queued
      if (task.units > limits.maxInputLength) { cancel(task, new MarkdownWorkerError('INPUT_LIMIT', 'Markdown source exceeds maxInputLength')); return }
      if (expired(task)) return
      queued = undefined; active = task; task.id = nextId(); task.sent = performance.now()
      binding.worker.postMessage({ protocol, type: 'update', id: task.id, revision: task.revision, source: task.source, ...(binding.base ? { htmlBaseRevision: binding.base.revision } : {}) })
      task.source = ''
    } catch { fail(new MarkdownWorkerError('WORKER_ERROR', 'Could not start Markdown update')) }
  }
  return {
    update(source, call = {}) {
      return new Promise<MarkdownWorkerUpdate>((resolve, reject) => {
        if (disposed) throw new MarkdownWorkerError('DISPOSED', 'Markdown worker client is disposed')
        if (typeof source !== 'string') throw new TypeError('Markdown source must be a string')
        const duration = timeout(call.timeoutMs ?? defaultTimeout), signal = call.signal
        if (signal !== undefined && (!signal || typeof signal.aborted !== 'boolean' || typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function')) throw new TypeError('signal must be an AbortSignal')
        if (signal?.aborted) throw new MarkdownWorkerError('ABORTED', 'Markdown update was aborted')
        if (source.length > limits.maxInputLength) throw new MarkdownWorkerError('INPUT_LIMIT', 'Markdown source exceeds maxInputLength')
        if (source.length > maxPending - (active?.units ?? 0)) throw new MarkdownWorkerError('QUEUE_FULL', 'Markdown update exceeds the pending source limit')
        if (revision >= Number.MAX_SAFE_INTEGER) throw new RangeError('Markdown revision limit reached')
        clearIdle()
        const now = performance.now(), task: Pending = { source, units: source.length, revision: ++revision, created: now,
          deadline: now + duration, signal, settled: false, resolve, reject }
        const previous = queued; queued = task
        for (const old of [active, previous]) if (old && !old.settled) {
          supersededUpdates++; settle(old, new MarkdownWorkerError('SUPERSEDED', 'Markdown update was superseded'))
        }
        if (previous) release(previous)
        if (signal) {
          task.abort = () => cancel(task, new MarkdownWorkerError('ABORTED', 'Markdown update was aborted'))
          try { signal.addEventListener('abort', task.abort, { once: true }); if (signal.aborted) task.abort() }
          catch { cancel(task, new MarkdownWorkerError('ABORTED', 'Could not observe Markdown cancellation')) }
        }
        if (task.settled) return
        task.timer = setTimeout(() => cancel(task, new MarkdownWorkerError('TIMEOUT', 'Markdown update exceeded its deadline')), duration)
        schedule()
      })
    },
    dispose() {
      if (disposed) return
      disposed = true; fail(new MarkdownWorkerError('DISPOSED', 'Markdown worker client is disposed'))
      configuration = undefined; factory = undefined
    },
    get metrics() { return { workerStarts, completedUpdates, supersededUpdates,
      pendingCount: Number(!!active) + Number(!!queued), pendingCodeUnits: (active?.units ?? 0) + (queued?.units ?? 0),
      activeRevision: active?.revision, queuedRevision: queued?.revision } },
  }
}
