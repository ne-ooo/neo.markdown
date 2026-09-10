import { createIncrementalMarkdown, IncrementalMarkdownLimitError, type IncrementalMarkdownOptions } from '@lpm.dev/neo.markdown/incremental'
import { MarkdownApplicationError, type MarkdownSynchronousSession } from '@lpm.dev/neo.markdown/application'
import type { DocumentOptions } from '../core/types.js'
import { integer } from '../experimental/worker/protocol.js'

export interface MarkdownSynchronousOptions extends IncrementalMarkdownOptions { document?: DocumentOptions }

/** A bounded synchronous backend, with the same rotation policy as a Markdown worker. */
export function createMarkdownSynchronousSession(options: MarkdownSynchronousOptions = {}): MarkdownSynchronousSession {
  let configuration: IncrementalMarkdownOptions | undefined = { ...options,
    maxInputLength: integer(options.maxInputLength ?? 250_000, 'maxInputLength'),
    maxUpdates: integer(options.maxUpdates ?? 1000, 'maxUpdates'),
    maxWorkCodeUnits: integer(options.maxWorkCodeUnits ?? 16_000_000, 'maxWorkCodeUnits'),
  }
  let document: DocumentOptions | undefined = {
    maxStylesheets: integer(Math.min(options.document?.maxStylesheets ?? 64, 64), 'maxStylesheets'),
    maxStylesheetLength: integer(Math.min(options.document?.maxStylesheetLength ?? 1_000_000, 1_000_000), 'maxStylesheetLength'),
    maxDiagnostics: integer(Math.min(options.document?.maxDiagnostics ?? 1000, 1000), 'maxDiagnostics'),
    maxTocEntries: integer(Math.min(options.document?.maxTocEntries ?? 10_000, 10_000), 'maxTocEntries'),
  }
  const maxInput = Math.min(configuration.maxInputLength!, configuration.parser?.maxInputLength ?? Infinity, configuration.parser?.ugc ? 1_000_000 : Infinity)
  integer(maxInput, 'parser maxInputLength')
  const maxUpdates = configuration.maxUpdates!, maxWork = configuration.maxWorkCodeUnits!
  let handling = false
  let session: ReturnType<typeof createIncrementalMarkdown> | undefined
  function release() { const old = session; session = undefined; old?.dispose() }
  return {
    update(source) {
      if (!configuration) throw new MarkdownApplicationError('DISPOSED', 'Markdown synchronous session is disposed')
      if (handling) throw new Error('Markdown synchronous session is reentrant')
      if (typeof source !== 'string') throw new TypeError('Markdown source must be a string')
      if (source.length > maxInput) { release(); throw new MarkdownApplicationError('INPUT_LIMIT', 'Markdown source exceeds maxInputLength') }
      handling = true
      try {
        if (session && (session.metrics.updates >= maxUpdates || session.metrics.workCodeUnits >= maxWork * 0.75 || source.length * 3 > maxWork - session.metrics.workCodeUnits)) release()
        if (!session) {
          const created = createIncrementalMarkdown(configuration)
          if (!configuration) { created.dispose(); throw new MarkdownApplicationError('DISPOSED', 'Markdown synchronous session is disposed') }
          session = created
        }
        const current = session, result = current.update(source, document)
        if (!configuration || session !== current) throw new MarkdownApplicationError('DISPOSED', 'Markdown synchronous session is disposed')
        return result
      } catch (error) {
        release()
        if (error instanceof IncrementalMarkdownLimitError) throw new MarkdownApplicationError(error.limit === 'maxInputLength' ? 'INPUT_LIMIT' : 'WORK_LIMIT', error.message, { cause: error })
        throw error
      } finally { handling = false }
    },
    dispose() { release(); configuration = undefined; document = undefined },
  }
}
