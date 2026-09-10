import type { DocumentResult } from '../../core/types.js'

export const MARKDOWN_WORKER_PROTOCOL = 'neo.markdown/1' as const
export type MarkdownWorkerConfiguration = null | boolean | number | string
  | readonly MarkdownWorkerConfiguration[] | { readonly [key: string]: MarkdownWorkerConfiguration }

export interface MarkdownWorkerLimits {
  maxInputLength: number
  maxResultCodeUnits: number
  maxStylesheets: number
  maxDiagnostics: number
  maxTocEntries: number
}
export const defaultLimits: Readonly<MarkdownWorkerLimits> = Object.freeze({
  maxInputLength: 250_000, maxResultCodeUnits: 2_000_000,
  maxStylesheets: 64, maxDiagnostics: 1_000, maxTocEntries: 10_000,
})
export type MarkdownWorkerErrorCode = 'ABORTED' | 'SUPERSEDED' | 'TIMEOUT' | 'DISPOSED' | 'QUEUE_FULL'
  | 'WORKER_ERROR' | 'PROTOCOL_ERROR' | 'CONFIGURATION_ERROR' | 'INPUT_LIMIT' | 'WORK_LIMIT' | 'OUTPUT_LIMIT' | 'RENDER_ERROR'
export class MarkdownWorkerError extends Error {
  constructor(readonly code: MarkdownWorkerErrorCode, message: string, readonly remoteName?: string) {
    super(message)
    this.name = code === 'ABORTED' || code === 'SUPERSEDED' ? 'AbortError' : code === 'TIMEOUT' ? 'TimeoutError' : 'MarkdownWorkerError'
  }
}
export interface MarkdownWorkerMetrics {
  sessionGeneration: number
  sessionRotations: number
  updates: number
  sourceLength: number
  workCodeUnits: number
  parsedBlockCodeUnits: number
  reusedBlockCodeUnits: number
  parsedInlineCodeUnits: number
  reusedInlineCodeUnits: number
  processingMs: number
}
export type MarkdownWorkerRequest =
  | { protocol: typeof MARKDOWN_WORKER_PROTOCOL; type: 'open'; id: number; configuration: MarkdownWorkerConfiguration; limits: MarkdownWorkerLimits; htmlDeltas?: boolean }
  | { protocol: typeof MARKDOWN_WORKER_PROTOCOL; type: 'update'; id: number; revision: number; source: string; htmlBaseRevision?: number }
export type MarkdownWorkerResponse =
  | { protocol: typeof MARKDOWN_WORKER_PROTOCOL; type: 'ready'; id: number; limits: MarkdownWorkerLimits; htmlDeltas?: boolean }
  | { protocol: typeof MARKDOWN_WORKER_PROTOCOL; type: 'result'; id: number; revision: number; result: DocumentResult; metrics: MarkdownWorkerMetrics }
  | { protocol: typeof MARKDOWN_WORKER_PROTOCOL; type: 'html-delta'; id: number; revision: number; result: Omit<DocumentResult, 'html'>; delta: MarkdownHtmlDelta; metrics: MarkdownWorkerMetrics }
  | { protocol: typeof MARKDOWN_WORKER_PROTOCOL; type: 'error'; id: number; revision?: number; error: { code: MarkdownWorkerErrorCode; name: string; message: string } }

export interface MarkdownHtmlDelta {
  baseRevision: number
  start: number
  deleteCount: number
  insert: string
}

/** Compare complete final HTML. Rendering, callbacks, and sanitization already ran. */
export function htmlDelta(before: string, after: string, baseRevision: number): MarkdownHtmlDelta | undefined {
  let start = 0, suffix = 0
  const common = Math.min(before.length, after.length)
  while (start < common && before.charCodeAt(start) === after.charCodeAt(start)) start++
  while (suffix < common - start && before.charCodeAt(before.length - suffix - 1) === after.charCodeAt(after.length - suffix - 1)) suffix++
  const insertLength = after.length - start - suffix
  if (insertLength + 128 >= after.length) return undefined
  return { baseRevision, start, deleteCount: before.length - start - suffix, insert: after.slice(start, after.length - suffix) }
}

export function applyHtmlDelta(input: unknown, base: { revision: number; html: string } | undefined, maxLength: number): string {
  const delta = record(input)
  if (!base || delta.baseRevision !== base.revision) throw new TypeError('HTML delta requires the acknowledged base revision')
  const start = integer(delta.start as number, 'HTML delta start', 0, base.html.length)
  const removed = integer(delta.deleteCount as number, 'HTML delta deleteCount', 0, base.html.length - start)
  if (typeof delta.insert !== 'string') throw new TypeError('HTML delta requires a string insertion')
  if (delta.insert.length > maxLength - (base.html.length - removed)) throw new MarkdownWorkerError('OUTPUT_LIMIT', 'Reconstructed HTML exceeds maxResultCodeUnits')
  return base.html.slice(0, start) + delta.insert + base.html.slice(start + removed)
}

export function integer(value: number, name: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new RangeError(`${name} must be an integer from ${minimum} to ${maximum}`)
  return value
}
export function record(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Worker message must be an object')
  return input as Record<string, unknown>
}
export function readLimits(input: Partial<MarkdownWorkerLimits> = {}, complete = false): MarkdownWorkerLimits {
  const result = { ...defaultLimits }
  for (const key of Object.keys(result) as (keyof MarkdownWorkerLimits)[]) {
    if (complete && typeof input[key] !== 'number') throw new TypeError('Incomplete worker limits')
    result[key] = integer(input[key] ?? result[key], key)
  }
  return result
}

/** JSON-shaped data only. Snapshot descriptors without invoking accessors, with fixed finite transport bounds. */
export function copyConfiguration(input: unknown): MarkdownWorkerConfiguration {
  let nodes = 0, units = 0
  const active = new Set<object>()
  function copy(value: unknown, depth: number): MarkdownWorkerConfiguration {
    if (++nodes > 1024 || depth > 16 || units > 16_384) throw new RangeError('Worker configuration exceeds its transport limits')
    if (value === null || typeof value === 'boolean') return value
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string') { units += value.length; if (units > 16_384) throw new RangeError('Worker configuration exceeds its transport limits'); return value }
    if (!value || typeof value !== 'object' || active.has(value)) throw new TypeError('Worker configuration requires finite, acyclic JSON data')
    const array = Array.isArray(value), prototype = Object.getPrototypeOf(value)
    if (!array && prototype !== Object.prototype && prototype !== null) throw new TypeError('Worker configuration requires plain objects')
    // Reject oversized containers before allocating a descriptor map or copying their entries.
    if (array && value.length > 1024 - nodes) throw new RangeError('Worker configuration exceeds its transport limits')
    const keys = Reflect.ownKeys(value)
    if (keys.length > 1025 - nodes) throw new RangeError('Worker configuration exceeds its transport limits')
    active.add(value)
    const result: Record<string, MarkdownWorkerConfiguration> | MarkdownWorkerConfiguration[] = array ? [] : Object.create(null)
    for (const key of keys) {
      if (array && key === 'length') continue
      if (typeof key !== 'string') throw new TypeError('Worker configuration cannot contain symbol keys')
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!
      if (!descriptor.enumerable || !('value' in descriptor)) throw new TypeError('Worker configuration requires enumerable data properties')
      if (array && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)) throw new TypeError('Worker configuration requires dense arrays')
      units += key.length
      Object.defineProperty(result, key, { value: copy(descriptor.value, depth + 1), enumerable: true })
    }
    active.delete(value)
    if (array && Object.keys(result).length !== value.length) throw new TypeError('Worker configuration requires dense arrays')
    return Object.freeze(result)
  }
  return copy(input, 0)
}

/** Copy and freeze known result fields. Native message cloning does not preserve Object.freeze. */
export function copyResult(input: unknown, limits: MarkdownWorkerLimits): DocumentResult {
  const data = record(input)
  let units = 0
  const text = (value: unknown): string => {
    if (typeof value !== 'string') throw new TypeError('Invalid worker result string')
    if (value.length > limits.maxResultCodeUnits - units) throw new MarkdownWorkerError('OUTPUT_LIMIT', 'Markdown result exceeds maxResultCodeUnits')
    units += value.length; return value
  }
  const list = (value: unknown, max: number): unknown[] => {
    if (!Array.isArray(value)) throw new TypeError('Invalid worker result array')
    if (value.length > max) throw new MarkdownWorkerError('OUTPUT_LIMIT', 'Markdown result exceeds its entry limits')
    return value
  }
  const html = text(data.html)
  const ids = new Set<string>()
  const stylesheets = list(data.stylesheets, limits.maxStylesheets).map(value => {
    const asset = record(value), id = text(asset.id), css = text(asset.css)
    if (!id || ids.has(id)) throw new TypeError('Invalid worker stylesheet id')
    ids.add(id); return Object.freeze({ id, css })
  })
  const diagnostics = list(data.diagnostics, limits.maxDiagnostics).map(value => {
    const diagnostic = record(value), source = text(diagnostic.source), code = text(diagnostic.code), message = text(diagnostic.message)
    const severity = diagnostic.severity
    if (severity !== 'warning' && severity !== 'error') throw new TypeError('Invalid worker diagnostic severity')
    let codeBlock, metaRange
    if (diagnostic.codeBlock !== undefined) {
      const block = record(diagnostic.codeBlock)
      codeBlock = Object.freeze({ index: integer(block.index as number, 'code-block index', 1),
        ...(block.language !== undefined ? { language: text(block.language) } : {}) })
    }
    if (diagnostic.metaRange !== undefined) {
      const range = record(diagnostic.metaRange), start = integer(range.start as number, 'range start')
      metaRange = Object.freeze({ start, end: integer(range.end as number, 'range end', start) })
    }
    return Object.freeze({ source, code, message, severity,
      ...(diagnostic.field !== undefined ? { field: text(diagnostic.field) } : {}),
      ...(codeBlock ? { codeBlock } : {}), ...(metaRange ? { metaRange } : {}) })
  })
  const toc = list(data.toc, limits.maxTocEntries).map(value => {
    const entry = record(value)
    return Object.freeze({ level: integer(entry.level as number, 'TOC level', 1, 6), text: text(entry.text), id: text(entry.id) })
  })
  return Object.freeze({ html, stylesheets: Object.freeze(stylesheets), diagnostics: Object.freeze(diagnostics), toc: Object.freeze(toc) })
}

export function copyMetrics(input: unknown): MarkdownWorkerMetrics {
  const data = record(input)
  const result = {} as MarkdownWorkerMetrics
  for (const key of ['sessionGeneration', 'sessionRotations', 'updates', 'sourceLength', 'workCodeUnits',
    'parsedBlockCodeUnits', 'reusedBlockCodeUnits', 'parsedInlineCodeUnits', 'reusedInlineCodeUnits'] as const) result[key] = integer(data[key] as number, key)
  if (typeof data.processingMs !== 'number' || !Number.isFinite(data.processingMs) || data.processingMs < 0) throw new TypeError('Invalid worker processing time')
  result.processingMs = data.processingMs
  return Object.freeze(result)
}
