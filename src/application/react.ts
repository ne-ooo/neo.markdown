import { useEffect, useReducer, useRef, useState } from 'react'
import { createMarkdownApplication, type MarkdownApplicationOptions, type MarkdownApplicationOutcome } from '@lpm.dev/neo.markdown/application'

export type MarkdownDocumentPreview = (MarkdownApplicationOutcome | { status: 'pending'; result?: Extract<MarkdownApplicationOutcome, { status: 'ready' }>['result'] }) & { refresh(): void }

/** Memoize options. The hook owns resources after commit and disposes them on configuration changes or unmount. */
export function useMarkdownDocument(source: string, options: MarkdownApplicationOptions): MarkdownDocumentPreview {
  const owner = useRef<ReturnType<typeof createMarkdownApplication> | null>(null)
  const [attempt, refresh] = useReducer((value: number) => value + 1, 0)
  const [completed, setCompleted] = useState<{ source: string; options: MarkdownApplicationOptions; attempt: number; outcome: MarkdownApplicationOutcome } | null>(null)
  const [setupError, setSetupError] = useState<{ options: MarkdownApplicationOptions; attempt: number; error: unknown } | null>(null)
  useEffect(() => {
    setCompleted(previous => previous?.options === options ? previous : null)
    let current: ReturnType<typeof createMarkdownApplication>
    try { current = createMarkdownApplication(options) }
    catch (error) { setSetupError({ options, attempt, error }); return }
    setSetupError(null)
    owner.current = current
    return () => { current.dispose(); if (owner.current === current) owner.current = null }
  }, [options, attempt])
  useEffect(() => {
    const current = owner.current
    if (!current) return
    let cancelled = false
    void current.update(source).then(outcome => {
      if (!cancelled && current.isCurrent(outcome)) setCompleted({ source, options, attempt, outcome })
    }, error => {
      if (!cancelled) setCompleted({ source, options, attempt, outcome: { revision: 0, status: 'error', error } })
    })
    return () => { cancelled = true }
  }, [source, options, attempt])
  if (setupError?.options === options && setupError.attempt === attempt) return { status: 'error', revision: 0, error: setupError.error, refresh }
  const outcome = completed?.source === source && completed.options === options && completed.attempt === attempt
    ? completed.outcome : { status: 'pending' as const,
      result: completed?.options === options && completed.outcome.status === 'ready' ? completed.outcome.result : undefined }
  return { ...outcome, refresh }
}
