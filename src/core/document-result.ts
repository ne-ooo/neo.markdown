import type {
  CodeBlockRenderHook, DocumentContext, DocumentDiagnostic, DocumentOptions,
  DocumentResult, DocumentStylesheet, DocumentTocEntry,
} from './types.js'

function limit(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback
  if (resolved !== Infinity && (!Number.isSafeInteger(resolved) || resolved < 0)) {
    throw new RangeError(`${name} must be a non-negative safe integer or Infinity`)
  }
  return resolved
}

function text(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string') throw new TypeError(`${name} must be a string`)
}

/** Internal collector. Only frozen service methods are exposed to plugins. */
export class DocumentCollector {
  private readonly stylesheets = new Map<string, DocumentStylesheet>()
  private readonly diagnostics: DocumentDiagnostic[] = []
  private readonly toc: DocumentTocEntry[] = []
  private readonly limits: Required<DocumentOptions>
  private stylesheetLength = 0
  private blockCount = 0
  private block: DocumentDiagnostic['codeBlock']
  private closed = false
  private failure: { error: unknown } | undefined
  readonly context: DocumentContext

  constructor(options: DocumentOptions = {}) {
    this.limits = {
      maxStylesheets: limit(options.maxStylesheets, 64, 'maxStylesheets'),
      maxStylesheetLength: limit(options.maxStylesheetLength, 1_000_000, 'maxStylesheetLength'),
      maxDiagnostics: limit(options.maxDiagnostics, 1_000, 'maxDiagnostics'),
      maxTocEntries: limit(options.maxTocEntries, 10_000, 'maxTocEntries'),
    }
    this.context = Object.freeze({
      addStylesheet: (asset: DocumentStylesheet) => this.contribute(() => this.addStylesheet(asset)),
      reportDiagnostic: (diagnostic: DocumentDiagnostic) => this.contribute(() => this.reportDiagnostic(diagnostic)),
      addTocEntry: (entry: DocumentTocEntry) => this.contribute(() => this.addTocEntry(entry)),
    })
  }

  readonly renderCodeBlock: CodeBlockRenderHook = (context, render) => {
    const previous = this.block
    this.block = Object.freeze({ index: ++this.blockCount, ...(context.language ? { language: context.language } : {}) })
    try { return render() } finally { this.block = previous }
  }

  close(): void { this.closed = true }

  finish(html: string): DocumentResult {
    if (this.failure) throw this.failure.error
    text(html, 'Document HTML')
    this.close()
    return Object.freeze({ html,
      stylesheets: Object.freeze([...this.stylesheets.values()]),
      diagnostics: Object.freeze([...this.diagnostics]),
      toc: Object.freeze([...this.toc]),
    })
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('Document collection context is closed')
    if (this.failure) throw this.failure.error
  }

  private contribute(add: () => void): void {
    try { add() } catch (error) {
      // A callback can catch an error, but cannot turn a failed collection into a partial result.
      this.failure ??= { error }
      throw error
    }
  }

  private addStylesheet(asset: DocumentStylesheet): void {
    this.assertOpen()
    text(asset?.id, 'Stylesheet id'); text(asset?.css, 'Stylesheet css')
    if (!asset.id.length) throw new TypeError('Stylesheet id must not be empty')
    const previous = this.stylesheets.get(asset.id)
    if (previous) {
      if (previous.css !== asset.css) throw new Error(`Conflicting stylesheet id: ${asset.id}`)
      return
    }
    if (this.stylesheets.size >= this.limits.maxStylesheets) throw new RangeError('Document exceeds maxStylesheets')
    if (this.stylesheetLength + asset.css.length > this.limits.maxStylesheetLength) throw new RangeError('Document exceeds maxStylesheetLength')
    this.stylesheetLength += asset.css.length
    this.stylesheets.set(asset.id, Object.freeze({ id: asset.id, css: asset.css }))
  }

  private reportDiagnostic(diagnostic: DocumentDiagnostic): void {
    this.assertOpen()
    for (const key of ['source', 'code', 'message'] as const) text(diagnostic?.[key], `Diagnostic ${key}`)
    if (diagnostic.severity !== 'warning' && diagnostic.severity !== 'error') throw new TypeError('Invalid diagnostic severity')
    if (diagnostic.field !== undefined) text(diagnostic.field, 'Diagnostic field')
    const codeBlock = diagnostic.codeBlock ?? this.block
    if (codeBlock) {
      if (!Number.isSafeInteger(codeBlock.index) || codeBlock.index < 1) throw new TypeError('Invalid diagnostic code-block index')
      if (codeBlock.language !== undefined) text(codeBlock.language, 'Diagnostic language')
    }
    const range = diagnostic.metaRange
    if (range && (!Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end) || range.start < 0 || range.end < range.start)) {
      throw new TypeError('Invalid diagnostic metadata range')
    }
    if (this.diagnostics.length >= this.limits.maxDiagnostics) throw new RangeError('Document exceeds maxDiagnostics')
    this.diagnostics.push(Object.freeze({ source: diagnostic.source, code: diagnostic.code,
      severity: diagnostic.severity, message: diagnostic.message,
      ...(diagnostic.field !== undefined ? { field: diagnostic.field } : {}),
      ...(codeBlock ? { codeBlock: Object.freeze({ index: codeBlock.index, ...(codeBlock.language !== undefined ? { language: codeBlock.language } : {}) }) } : {}),
      ...(range ? { metaRange: Object.freeze({ start: range.start, end: range.end }) } : {}),
    }))
  }

  private addTocEntry(entry: DocumentTocEntry): void {
    this.assertOpen()
    if (!Number.isInteger(entry?.level) || entry.level < 1 || entry.level > 6) throw new TypeError('Invalid TOC level')
    text(entry.text, 'TOC text'); text(entry.id, 'TOC id')
    if (this.toc.length >= this.limits.maxTocEntries) throw new RangeError('Document exceeds maxTocEntries')
    this.toc.push(Object.freeze({ level: entry.level, text: entry.text, id: entry.id }))
  }
}
