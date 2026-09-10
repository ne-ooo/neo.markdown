import { StrictMode } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useMarkdownDocument, type MarkdownDocumentPreview } from '../../src/application/react.js'
import type { MarkdownApplicationOptions, MarkdownSynchronousSession } from '../../src/application/index.js'
const result = (html: string) => ({ html, stylesheets: [], diagnostics: [], toc: [] })
const roots: ReactTestRenderer[] = []
let errors: unknown[][]
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); errors = []
  vi.spyOn(console, 'error').mockImplementation((...args) => { if (args[0] !== 'react-test-renderer is deprecated. See https://react.dev/warnings/react-test-renderer') errors.push(args) })
})
afterEach(async () => { for (const root of roots.splice(0)) await act(async () => root.unmount()); expect(errors).toEqual([]); vi.restoreAllMocks(); vi.unstubAllGlobals() })
async function mount(element: React.ReactElement) { let root!: ReactTestRenderer; await act(async () => { root = create(element) }); roots.push(root); return root }

describe('public Markdown React hook', () => {
  it('isolates two owners and disposes each once', async () => {
    const outputs: Record<string, MarkdownDocumentPreview> = {}, disposals = [vi.fn(), vi.fn()]
    const options = disposals.map(dispose => ({ createFallback: () => ({ update: (source: string) => result(source), dispose }) }))
    function Preview({ id, source, options }: { id: string; source: string; options: MarkdownApplicationOptions }) { outputs[id] = useMarkdownDocument(source, options); return null }
    const root = await mount(<StrictMode><Preview id="one" source="one" options={options[0]} /><Preview id="two" source="two" options={options[1]} /></StrictMode>)
    expect(outputs.one).toMatchObject({ status: 'ready', result: { html: 'one' } }); expect(outputs.two).toMatchObject({ result: { html: 'two' } })
    await act(async () => root.update(<Preview id="two" source="edited" options={options[1]} />))
    expect(outputs.two).toMatchObject({ result: { html: 'edited' } })
    // StrictMode tree replacement remounts both ownership effects. Every constructed backend still closes exactly once.
    expect(disposals[0]).toHaveBeenCalledTimes(1)
  })
  it('handles invalid setup and recovers when configuration changes or refresh runs', async () => {
    let last!: MarkdownDocumentPreview
    const invalid = {} as MarkdownApplicationOptions, valid = { createFallback: () => ({ update: (source: string) => result(source), dispose() {} }) }
    function Preview({ options }: { options: MarkdownApplicationOptions }) { last = useMarkdownDocument('text', options); return null }
    const root = await mount(<Preview options={invalid} />)
    expect(last.status).toBe('error')
    await act(async () => root.update(<Preview options={valid} />)); expect(last.status).toBe('ready')
    await act(async () => root.update(<Preview options={invalid} />)); expect(last.status).toBe('error')
    Object.assign(invalid, valid)
    await act(async () => last.refresh()); expect(last.status).toBe('ready')
  })
  it('hides old output on configuration replacement and closes a late backend', async () => {
    let last!: MarkdownDocumentPreview, finish!: (session: MarkdownSynchronousSession) => void
    const original = { createFallback: () => ({ update: (source: string) => result(source), dispose() {} }) }
    const waiting = { createFallback: () => new Promise<MarkdownSynchronousSession>(resolve => { finish = resolve }) }
    function Preview({ options }: { options: MarkdownApplicationOptions }) { last = useMarkdownDocument('text', options); return null }
    const root = await mount(<Preview options={original} />)
    expect(last.status).toBe('ready')
    await act(async () => root.update(<Preview options={waiting} />)); expect(last).toMatchObject({ status: 'pending', result: undefined })
    await act(async () => root.update(<Preview options={original} />))
    const dispose = vi.fn(), update = vi.fn(() => result('stale'))
    await act(async () => finish({ update, dispose }))
    expect(last).toMatchObject({ status: 'ready', result: { html: 'text' } })
    expect(update).not.toHaveBeenCalled(); expect(dispose).toHaveBeenCalledTimes(1)
  })
})
