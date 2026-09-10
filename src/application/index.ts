import type { DocumentResult } from '../core/types.js'
import {
  createMarkdownWorkerClient, MarkdownWorkerError,
  type MarkdownWorkerClient, type MarkdownWorkerClientOptions, type MarkdownWorkerCallOptions,
  type MarkdownWorkerConfiguration, type MarkdownWorkerLimits, type MarkdownWorkerErrorCode,
} from '@lpm.dev/neo.markdown/worker-client'
import { copyConfiguration, copyResult, integer, readLimits, MarkdownWorkerError as ResultLimitError } from '../experimental/worker/protocol.js'

export type { MarkdownWorkerConfiguration, MarkdownWorkerLimits } from '@lpm.dev/neo.markdown/worker-client'
export type MarkdownApplicationErrorCode = MarkdownWorkerErrorCode
export class MarkdownApplicationError extends Error {
  constructor(readonly code: MarkdownApplicationErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = code === 'SUPERSEDED' || code === 'ABORTED' ? 'AbortError' : code === 'TIMEOUT' ? 'TimeoutError' : 'MarkdownApplicationError'
  }
}
/** The fallback runs synchronously. Its factory can load code asynchronously. */
export interface MarkdownSynchronousSession {
  update(source: string): DocumentResult
  dispose(): void
}
export interface MarkdownApplicationOptions extends Omit<MarkdownWorkerClientOptions, 'createWorker'> {
  /** Select worker mode explicitly. Runtime worker failures never switch to the fallback. */
  createWorker?: MarkdownWorkerClientOptions['createWorker']
  /** Used only without createWorker. Cooperate with signal to stop abandoned asynchronous setup. */
  createFallback?: (configuration: MarkdownWorkerConfiguration, signal: AbortSignal) => MarkdownSynchronousSession | Promise<MarkdownSynchronousSession>
}
export type MarkdownApplicationOutcome = Readonly<{ revision: number } & (
  | { status: 'ready'; result: DocumentResult }
  | { status: 'input-limit' | 'work-limit' | 'error'; error: unknown }
)>
export interface MarkdownApplication {
  update(source: string, options?: MarkdownWorkerCallOptions): Promise<MarkdownApplicationOutcome>
  /** Reject pending requests and release backend state. The next update starts a new backend. */
  reset(): void
  dispose(): void
  /** Check immediately before committing output outside the adapter, including after other awaits. */
  isCurrent(outcome: MarkdownApplicationOutcome): boolean
  readonly metrics: {
    mode: 'worker' | 'synchronous'; generations: number; updates: number; pending: boolean; disposed: boolean
    worker?: MarkdownWorkerClient['metrics']
  }
}
interface Task {
  source: string; revision: number; deadline: number
  resolve: (outcome: MarkdownApplicationOutcome) => void; reject: (error: unknown) => void
  timer?: ReturnType<typeof setTimeout>; signal?: AbortSignal; abort?: () => void
}
interface Opening { controller: AbortController; timer?: ReturnType<typeof setTimeout> }
const duration = (value: number) => integer(value, 'timeoutMs', 1, 2_147_483_647)

/** One document owner. No worker, factory, or parser runs during construction. */
export function createMarkdownApplication(options: MarkdownApplicationOptions): MarkdownApplication {
  let createWorker = options?.createWorker, createFallback = options?.createFallback
  if (createWorker !== undefined && typeof createWorker !== 'function') throw new TypeError('createWorker must be a function')
  if (createFallback !== undefined && typeof createFallback !== 'function') throw new TypeError('createFallback must be a function')
  if (!createWorker && !createFallback) throw new TypeError('Provide createWorker or createFallback')
  const htmlDeltas = options.htmlDeltas ?? false
  if (typeof htmlDeltas !== 'boolean') throw new TypeError('htmlDeltas must be a boolean')
  const mode: 'worker' | 'synchronous' = createWorker ? 'worker' : 'synchronous'
  let configuration: MarkdownWorkerConfiguration | undefined = copyConfiguration(options.configuration ?? null)
  const limits: MarkdownWorkerLimits = readLimits(options.limits)
  const timeoutMs = duration(options.timeoutMs ?? 5000)
  const idleTimeoutMs = integer(options.idleTimeoutMs ?? 30_000, 'idleTimeoutMs', 0, 2_147_483_647)
  const maxPendingCodeUnits = integer(options.maxPendingCodeUnits ?? 500_000, 'maxPendingCodeUnits')
  let client: MarkdownWorkerClient | undefined, fallback: MarkdownSynchronousSession | undefined, opening: Opening | undefined
  let pending: Task | undefined, latest: MarkdownApplicationOutcome | undefined
  let disposed = false, scheduled = false, revision = 0, generations = 0
  let idle: ReturnType<typeof setTimeout> | undefined
  function clearIdle() { if (idle !== undefined) clearTimeout(idle); idle = undefined }
  const retired = new WeakSet<MarkdownSynchronousSession>()
  function close(session: MarkdownSynchronousSession) { retired.add(session); try { session.dispose() } catch { /* Cleanup cannot leave requests pending. */ } }
  function retire() {
    clearIdle()
    const oldClient = client, oldFallback = fallback, oldOpening = opening
    client = undefined; fallback = undefined; opening = undefined
    oldClient?.dispose()
    if (oldFallback) close(oldFallback)
    if (oldOpening) { clearTimeout(oldOpening.timer); oldOpening.controller.abort() }
  }
  function settle(task: Task, outcome?: MarkdownApplicationOutcome, error?: unknown) {
    if (pending !== task) return
    pending = undefined; clearTimeout(task.timer)
    try { if (task.abort) task.signal?.removeEventListener('abort', task.abort) } catch { /* Continue settlement. */ }
    task.source = ''; task.signal = undefined; task.abort = undefined
    if (outcome) { latest = Object.freeze(outcome); task.resolve(latest) } else task.reject(error)
  }
  function rejectPending(code: MarkdownApplicationErrorCode, message: string) {
    if (pending) settle(pending, undefined, new MarkdownApplicationError(code, message))
  }
  function failure(task: Task, error: unknown) {
    if (pending !== task) return
    const normalized = (error instanceof MarkdownWorkerError || error instanceof ResultLimitError) ? new MarkdownApplicationError(error.code, error.message, { cause: error }) : error
    const code = normalized instanceof MarkdownApplicationError ? normalized.code : undefined
    if (code === 'SUPERSEDED' || code === 'ABORTED' || code === 'DISPOSED') { settle(task, undefined, normalized); return }
    settle(task, { revision: task.revision, status: code === 'INPUT_LIMIT' ? 'input-limit' : code === 'WORK_LIMIT' ? 'work-limit' : 'error', error: normalized })
  }
  function timeout(task: Task) {
    if (pending !== task) return
    // Settle before teardown: a custom disposal callback can request another update.
    failure(task, new MarkdownApplicationError('TIMEOUT', 'Markdown application update exceeded its deadline'))
    retire()
  }
  function ready(task: Task, result: DocumentResult) {
    if (pending !== task || disposed) return
    if (performance.now() >= task.deadline) { timeout(task); return }
    settle(task, { revision: task.revision, status: 'ready', result })
    if (mode === 'synchronous' && idleTimeoutMs) {
      idle = setTimeout(() => { if (!pending) retire() }, idleTimeoutMs)
    }
  }
  function schedule() {
    if (scheduled || disposed) return
    scheduled = true
    queueMicrotask(() => { scheduled = false; runFallback() })
  }
  function runFallback() {
    const task = pending
    if (!task || disposed) return
    if (performance.now() >= task.deadline) { timeout(task); return }
    if (opening) return
    if (!fallback) {
      const current: Opening = { controller: new AbortController() }
      opening = current; generations++
      current.timer = setTimeout(() => {
        if (opening !== current) return
        if (pending) failure(pending, new MarkdownApplicationError('TIMEOUT', 'Markdown fallback setup exceeded its deadline'))
        retire()
      }, Math.max(1, task.deadline - performance.now()))
      let result: MarkdownSynchronousSession | Promise<MarkdownSynchronousSession>
      try { result = createFallback!(configuration!, current.controller.signal) }
      catch (error) { if (opening === current) { const failed = pending; retire(); if (failed) failure(failed, error) }; return }
      void Promise.resolve(result).then(session => {
        if (!session || typeof session.update !== 'function' || typeof session.dispose !== 'function') {
          if (session && typeof session.dispose === 'function') close(session)
          throw new TypeError('Fallback factory must return a synchronous Markdown session')
        }
        if (retired.has(session)) throw new TypeError('Fallback factory must return a fresh session')
        if (opening !== current || disposed) { close(session); return }
        clearTimeout(current.timer); opening = undefined; fallback = session; schedule()
      }).catch(error => { if (opening === current) { const failed = pending; retire(); if (failed) failure(failed, error) } })
      return
    }
    const session = fallback, source = task.source
    task.source = ''
    try {
      const result = session.update(source)
      if (result instanceof Promise) { void result.catch(() => {}); throw new TypeError('Fallback update must be synchronous') }
      if (pending !== task || fallback !== session || disposed) return
      ready(task, copyResult(result, limits))
    } catch (error) {
      if (pending !== task || fallback !== session) return
      retire(); failure(task, error)
    }
  }
  return {
    update(source, call = {}) {
      return new Promise<MarkdownApplicationOutcome>((resolve, reject) => {
        if (disposed) throw new MarkdownApplicationError('DISPOSED', 'Markdown application is disposed')
        if (typeof source !== 'string') throw new TypeError('Markdown source must be a string')
        const ms = duration(call.timeoutMs ?? timeoutMs), signal = call.signal
        if (signal !== undefined && (!signal || typeof signal.aborted !== 'boolean' || typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function')) throw new TypeError('signal must be an AbortSignal')
        if (signal?.aborted) throw new MarkdownApplicationError('ABORTED', 'Markdown application update was aborted')
        if (revision >= Number.MAX_SAFE_INTEGER) throw new RangeError('Markdown application revision limit reached')
        clearIdle(); latest = undefined
        rejectPending('SUPERSEDED', 'Markdown application update was superseded')
        const task: Task = { source, revision: ++revision, deadline: performance.now() + ms, resolve, reject, signal }
        pending = task
        if (source.length > limits.maxInputLength) { retire(); failure(task, new MarkdownApplicationError('INPUT_LIMIT', 'Markdown source exceeds maxInputLength')); return }
        if (source.length > maxPendingCodeUnits) { retire(); failure(task, new MarkdownApplicationError('QUEUE_FULL', 'Markdown source exceeds maxPendingCodeUnits')); return }
        task.abort = () => {
          if (pending !== task) return
          settle(task, undefined, new MarkdownApplicationError('ABORTED', 'Markdown application update was aborted')); retire()
        }
        if (signal) {
          try { signal.addEventListener('abort', task.abort, { once: true }); if (signal.aborted) task.abort() }
          catch { task.abort?.() }
        }
        if (pending !== task) return
        task.timer = setTimeout(() => timeout(task), ms)
        if (mode === 'synchronous') { schedule(); return }
        try {
          if (!client) { client = createMarkdownWorkerClient({ createWorker: createWorker!, configuration, limits, timeoutMs, idleTimeoutMs, maxPendingCodeUnits, htmlDeltas }); generations++ }
          const result = client.update(source, call); task.source = ''
          void result.then(update => ready(task, update.result), error => failure(task, error))
        } catch (error) { retire(); failure(task, error) }
      })
    },
    reset() { if (disposed) return; latest = undefined; rejectPending('ABORTED', 'Markdown application was reset'); retire() },
    dispose() {
      if (disposed) return
      disposed = true; latest = undefined; rejectPending('DISPOSED', 'Markdown application is disposed'); retire()
      createWorker = undefined; createFallback = undefined; configuration = undefined
    },
    isCurrent(outcome) { return !disposed && latest !== undefined && latest === outcome },
    get metrics(): MarkdownApplication['metrics'] { return { mode, generations, updates: revision, pending: !!pending, disposed, ...(client ? { worker: client.metrics } : {}) } },
  }
}
