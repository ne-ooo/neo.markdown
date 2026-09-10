// Keep one runtime for session contracts across package entries and module formats.
import { createIncrementalMarkdown, IncrementalMarkdownLimitError, type IncrementalMarkdownOptions } from '@lpm.dev/neo.markdown/experimental'
import type { DocumentOptions } from '../core/types.js'
import {
  MARKDOWN_WORKER_PROTOCOL as protocol, MarkdownWorkerError, integer, record, readLimits, copyConfiguration, copyResult, htmlDelta,
  type MarkdownWorkerConfiguration, type MarkdownWorkerLimits, type MarkdownWorkerResponse, type MarkdownWorkerErrorCode,
} from './worker/protocol.js'
export type { MarkdownWorkerConfiguration, MarkdownWorkerLimits, MarkdownWorkerRequest, MarkdownWorkerResponse, MarkdownWorkerMetrics } from './worker/protocol.js'

export interface MarkdownWorkerOptions {
  /** Trusted worker-local factory. Functions, grammars, and sanitizer providers stay inside this worker. */
  configure?: (configuration: MarkdownWorkerConfiguration) => { session?: IncrementalMarkdownOptions; document?: DocumentOptions }
  /** Worker-owned ceilings. Client limits can only lower them. */
  limits?: Partial<MarkdownWorkerLimits>
  /** Rotate the parser between updates, before it reaches these finite session ceilings. */
  maxUpdates?: number
  maxWorkCodeUnits?: number
}
export interface MarkdownWorkerScope {
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void
  removeEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void
  postMessage(response: MarkdownWorkerResponse): void
}

/** One document per handler. Failures never repeat an interrupted render. */
export function createMarkdownWorkerHandler(options: MarkdownWorkerOptions = {}) {
  let configure = options.configure
  if (configure !== undefined && typeof configure !== 'function') throw new TypeError('configure must be a function')
  const ceilings = readLimits(options.limits)
  const maxUpdates = integer(options.maxUpdates ?? 1000, 'maxUpdates')
  const maxWork = integer(options.maxWorkCodeUnits ?? 16_000_000, 'maxWorkCodeUnits')
  let sessionOptions: IncrementalMarkdownOptions | undefined, documentOptions: DocumentOptions | undefined
  let htmlDeltas = false, base: { revision: number; html: string } | undefined
  let limits = ceilings, session: ReturnType<typeof createIncrementalMarkdown> | undefined
  let closed = false, opened = false, handling = false, lastId = 0, revision = 0, generation = 0, rotations = 0
  const release = () => { session?.dispose(); session = undefined }
  function dispose() { closed = true; base = undefined; release(); sessionOptions = undefined; documentOptions = undefined; configure = undefined }
  function failure(id: number, error: unknown, fallback: MarkdownWorkerErrorCode, requestRevision?: number): MarkdownWorkerResponse {
    let code = fallback, name = 'Error', message = 'Markdown worker request failed'
    try {
      if (error instanceof MarkdownWorkerError) code = error.code
      if (error instanceof IncrementalMarkdownLimitError) code = error.limit === 'maxInputLength' ? 'INPUT_LIMIT' : 'WORK_LIMIT'
      if (error instanceof Error) { name = String(error.name).slice(0, 100); message = String(error.message).slice(0, 1000) }
    } catch { /* Error serialization cannot expose arbitrary thrown values or prevent settlement. */ }
    return { protocol, type: 'error', id, ...(requestRevision !== undefined ? { revision: requestRevision } : {}), error: { code, name, message } }
  }
  function handle(input: unknown): MarkdownWorkerResponse {
    let id = 0, requestRevision: number | undefined, stage: MarkdownWorkerErrorCode = 'PROTOCOL_ERROR'
    if (handling) { dispose(); return failure(id, new TypeError('Markdown worker handler is reentrant'), stage) }
    handling = true
    try {
      if (closed) throw new TypeError('Markdown worker handler is closed')
      const request = record(input)
      id = integer(request.id as number, 'request id', 1)
      if (request.protocol !== protocol || id <= lastId) throw new TypeError('Invalid Markdown worker protocol or request id')
      lastId = id
      if (request.type === 'open') {
        if (opened) throw new TypeError('Markdown worker is already configured')
        stage = 'CONFIGURATION_ERROR'
        if (request.htmlDeltas !== undefined && typeof request.htmlDeltas !== 'boolean') throw new TypeError('htmlDeltas must be a boolean')
        htmlDeltas = request.htmlDeltas === true
        const clientLimits = readLimits(record(request.limits), true)
        limits = { ...ceilings }
        for (const key of Object.keys(limits) as (keyof MarkdownWorkerLimits)[]) limits[key] = Math.min(limits[key], clientLimits[key])
        const configuration = copyConfiguration(request.configuration)
        const configured = configure?.(configuration) ?? {}
        if (configured instanceof Promise) void configured.catch(() => {})
        if (!configured || typeof configured !== 'object' || 'then' in configured) throw new TypeError('Worker configuration must return synchronous options')
        if (closed) throw new TypeError('Markdown worker handler is closed')
        const supplied = configured.session ?? {}
        sessionOptions = { ...supplied,
          maxInputLength: Math.min(limits.maxInputLength, integer(supplied.maxInputLength ?? limits.maxInputLength, 'maxInputLength')),
          maxUpdates: Math.min(maxUpdates, integer(supplied.maxUpdates ?? maxUpdates, 'maxUpdates')),
          maxWorkCodeUnits: Math.min(maxWork, integer(supplied.maxWorkCodeUnits ?? maxWork, 'maxWorkCodeUnits')),
        }
        limits.maxInputLength = Math.min(sessionOptions.maxInputLength!, supplied.parser?.maxInputLength ?? Infinity, supplied.parser?.ugc ? 1_000_000 : Infinity)
        integer(limits.maxInputLength, 'parser maxInputLength')
        const document = configured.document ?? {}
        documentOptions = { maxStylesheets: Math.min(document.maxStylesheets ?? 64, limits.maxStylesheets),
          maxStylesheetLength: Math.min(document.maxStylesheetLength ?? 1_000_000, limits.maxResultCodeUnits),
          maxDiagnostics: Math.min(document.maxDiagnostics ?? 1000, limits.maxDiagnostics),
          maxTocEntries: Math.min(document.maxTocEntries ?? 10_000, limits.maxTocEntries) }
        for (const [key, value] of Object.entries(documentOptions)) integer(value, key)
        opened = true
        return { protocol, type: 'ready', id, limits: { ...limits }, ...(htmlDeltas ? { htmlDeltas: true } : {}) }
      }
      if (request.type !== 'update' || !opened || !sessionOptions) throw new TypeError('Markdown worker requires an open session')
      requestRevision = integer(request.revision as number, 'revision', 1)
      if (requestRevision <= revision || typeof request.source !== 'string') throw new TypeError('Invalid Markdown worker revision or source')
      if (request.htmlBaseRevision !== undefined) integer(request.htmlBaseRevision as number, 'HTML base revision', 1, requestRevision - 1)
      revision = requestRevision
      if (request.source.length > limits.maxInputLength) throw new MarkdownWorkerError('INPUT_LIMIT', 'Markdown source exceeds maxInputLength')
      stage = 'RENDER_ERROR'
      const start = performance.now()
      if (session) {
        const metrics = session.metrics, budget = sessionOptions.maxWorkCodeUnits!
        if (metrics.updates >= sessionOptions.maxUpdates! || metrics.workCodeUnits >= budget * 0.75
          || request.source.length * 3 > budget - metrics.workCodeUnits) { release(); rotations++ }
      }
      if (!session) { session = createIncrementalMarkdown(sessionOptions); generation++ }
      const result = copyResult(session.update(request.source, documentOptions), limits)
      if (closed) throw new TypeError('Markdown worker handler is closed')
      const delta = htmlDeltas && base && request.htmlBaseRevision === base.revision ? htmlDelta(base.html, result.html, base.revision) : undefined
      if (htmlDeltas) base = { revision, html: result.html }
      const metrics = session.metrics
      const response = { protocol, type: 'result' as const, id, revision, result, metrics: {
        sessionGeneration: generation, sessionRotations: rotations, updates: metrics.updates,
        sourceLength: metrics.sourceLength, workCodeUnits: metrics.workCodeUnits,
        parsedBlockCodeUnits: metrics.parsedBlockCodeUnits, reusedBlockCodeUnits: metrics.reusedBlockCodeUnits,
        parsedInlineCodeUnits: metrics.parsedInlineCodeUnits, reusedInlineCodeUnits: metrics.reusedInlineCodeUnits,
        processingMs: performance.now() - start,
      } }
      if (!delta) return response
      const { html: _html, ...assets } = result
      return { ...response, type: 'html-delta', result: assets, delta }
    } catch (error) {
      base = undefined
      release()
      // A valid update failure permits a later revision. Protocol and setup failures require a new worker.
      if (stage === 'PROTOCOL_ERROR' && !(error instanceof MarkdownWorkerError && error.code === 'INPUT_LIMIT') || stage === 'CONFIGURATION_ERROR') dispose()
      return failure(id, error, stage, requestRevision)
    } finally { handling = false }
  }
  return { handle, dispose }
}

/** Install only when called by an application-owned worker entry. Imports have no global side effects. */
export function installMarkdownWorker(scope: MarkdownWorkerScope, options: MarkdownWorkerOptions = {}): () => void {
  const handler = createMarkdownWorkerHandler(options)
  let disposed = false
  function dispose() {
    if (disposed) return
    disposed = true
    try { scope.removeEventListener('message', listener) } finally { handler.dispose() }
  }
  function listener(event: MessageEvent<unknown>) {
    if (disposed) return
    try { scope.postMessage(handler.handle(event.data)) }
    catch (error) { try { dispose() } catch { /* Preserve the transport error. */ } throw error }
  }
  try { scope.addEventListener('message', listener) }
  catch (error) { try { dispose() } catch { /* Preserve the registration error. */ } throw error }
  return dispose
}
