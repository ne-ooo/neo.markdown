export type IncrementalMarkdownLimit = 'maxInputLength' | 'maxUpdates' | 'maxWorkCodeUnits'

/** A session-owned limit. This error does not imply that an update is safe to retry. */
export class IncrementalMarkdownLimitError extends RangeError {
  constructor(readonly limit: IncrementalMarkdownLimit) {
    super(`Incremental Markdown exceeds ${limit}`)
    this.name = 'IncrementalMarkdownLimitError'
  }
}
