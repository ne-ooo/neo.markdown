import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMarkdownApplication, MarkdownApplicationError, type MarkdownSynchronousSession, type MarkdownApplication } from '../../src/application/index.js'
import { createMarkdownSynchronousSession } from '../../src/application/sync.js'
import { createMarkdownWorkerHandler } from '../../src/experimental/worker.js'
import { defineIncrementalPlugin } from '../../src/experimental/index.js'
import { createParser } from '../../src/index.js'
import { tocPlugin } from '../../src/plugins/toc.js'
const active: MarkdownApplication[] = []
const application = (...args: Parameters<typeof createMarkdownApplication>) => { const app = createMarkdownApplication(...args); active.push(app); return app }
const result = (html = '<p>result</p>\n') => ({ html, stylesheets: [], diagnostics: [], toc: [] })
const backend = () => ({ update: vi.fn((source: string) => result('<p>' + source + '</p>\n')), dispose: vi.fn() })
const rejected = (promise: Promise<unknown>) => promise.then(() => 'resolved', error => error.code)
const flush = async () => { for (let n = 0; n < 8; n++) await Promise.resolve() }
afterEach(() => { for (const app of active.splice(0)) app.dispose(); vi.useRealTimers() })

class WorkerTransport {
  listeners = new Map<string, Set<(event: any) => void>>()
  handler = createMarkdownWorkerHandler()
  disposed = false; auto = true; messages: any[] = []
  addEventListener(type: string, listener: (event: any) => void) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type)!.add(listener) }
  removeEventListener(type: string, listener: (event: any) => void) { this.listeners.get(type)?.delete(listener) }
  postMessage(data: any) { this.messages.push(data); if (this.auto) queueMicrotask(() => this.send(this.handler.handle(data))) }
  send(data: unknown) { for (const listener of this.listeners.get('message') ?? []) listener({ data }) }
  terminate() { this.disposed = true; this.handler.dispose() }
}

describe('application session ownership', () => {
  it('creates no backend until an update and commits only the current immutable result', async () => {
    const session = backend(), createFallback = vi.fn(() => session), app = application({ createFallback })
    expect(createFallback).not.toHaveBeenCalled()
    expect(app.isCurrent(undefined as never)).toBe(false)
    const first = await app.update('first')
    expect(app.isCurrent(first)).toBe(true); expect(Object.isFrozen(first)).toBe(true)
    expect(first.status).toBe('ready')
    if (first.status === 'ready') expect(Object.isFrozen(first.result.stylesheets)).toBe(true)
    const pending = app.update('second'); expect(app.isCurrent(first)).toBe(false)
    const second = await pending; expect(app.isCurrent(second)).toBe(true)
    expect(createFallback).toHaveBeenCalledTimes(1)
    app.reset(); expect(app.isCurrent(second)).toBe(false); expect(session.dispose).toHaveBeenCalledTimes(1)
    app.dispose(); app.dispose(); expect(await rejected(app.update('later'))).toBe('DISPOSED')
  })
  it('isolates configuration and complete custom-backend results', async () => {
    const configuration = { values: ['original'] }, output = result(), createFallback = vi.fn(() => ({ update: () => output, dispose() {} }))
    const app = application({ configuration, createFallback })
    configuration.values.push('changed')
    const completed = await app.update('text')
    expect(createFallback.mock.calls[0][0]).toEqual({ values: ['original'] })
    expect(Object.isFrozen(createFallback.mock.calls[0][0])).toBe(true)
    output.html = 'mutated'
    expect(completed).toMatchObject({ result: { html: '<p>result</p>\n' } })
  })
  it('coalesces synchronous edits and bounded asynchronous setup', async () => {
    let finish!: (session: MarkdownSynchronousSession) => void
    const session = backend(), createFallback = vi.fn(() => new Promise<MarkdownSynchronousSession>(resolve => { finish = resolve }))
    const app = application({ createFallback })
    const first = rejected(app.update('first')); await flush()
    const second = rejected(app.update('second')), third = app.update('third')
    expect(await first).toBe('SUPERSEDED'); expect(await second).toBe('SUPERSEDED')
    finish(session); expect((await third).revision).toBe(3)
    expect(createFallback).toHaveBeenCalledTimes(1); expect(session.update).toHaveBeenCalledExactlyOnceWith('third')
  })
  it('resolves limits and render failures without replaying callbacks', async () => {
    let calls = 0
    const error = new RangeError('plugin failure')
    const createFallback = vi.fn(() => ({ update() { calls++; throw error }, dispose() {} }))
    const app = application({ createFallback, limits: { maxInputLength: 5 } })
    const large = await app.update('oversized')
    expect(large).toMatchObject({ status: 'input-limit', error: { code: 'INPUT_LIMIT' } }); expect(createFallback).not.toHaveBeenCalled()
    expect(await app.update('short')).toMatchObject({ status: 'error', error })
    expect(calls).toBe(1)
    expect(await app.update('again')).toMatchObject({ status: 'error', error })
    expect(calls).toBe(2); expect(createFallback).toHaveBeenCalledTimes(2)
  })
  it.each(['output', 'entries', 'invalid', 'asynchronous'] as const)('rejects unusable fallback output: %s', async mode => {
    const session = backend()
    session.update = vi.fn(() => mode === 'output' ? result('x'.repeat(11)) : mode === 'entries' ? { ...result(''), stylesheets: [{ id: 'x', css: 'css' }] } : mode === 'asynchronous' ? Promise.reject(Error('not synchronous')) as never : {} as never)
    const app = application({ createFallback: () => session, limits: { maxResultCodeUnits: 10, maxStylesheets: 0 } })
    const outcome = await app.update('text')
    expect(outcome.status).toBe('error')
    if (mode === 'output' || mode === 'entries') expect(outcome).toMatchObject({ error: { code: 'OUTPUT_LIMIT' } })
    expect(session.dispose).toHaveBeenCalledTimes(1)
    await flush()
  })
  it('rejects retired fallback instances and closes malformed factory results', async () => {
    const session = backend(), app = application({ createFallback: () => session })
    await app.update('first'); app.reset()
    expect(await app.update('second')).toMatchObject({ status: 'error' })
    expect(session.update).toHaveBeenCalledTimes(1)
    const dispose = vi.fn(), malformed = application({ createFallback: () => ({ dispose }) as never })
    expect(await malformed.update('text')).toMatchObject({ status: 'error' }); expect(dispose).toHaveBeenCalledTimes(1)
  })
  it.each(['reset', 'dispose', 'abort', 'input-limit'] as const)('abandons asynchronous setup on %s and closes late sessions', async action => {
    let finish!: (session: MarkdownSynchronousSession) => void, signal!: AbortSignal
    const app = application({ createFallback: (_configuration, incoming) => { signal = incoming; return new Promise(resolve => { finish = resolve }) }, limits: { maxInputLength: 5 } })
    const controller = new AbortController(), pending = rejected(app.update('small', { signal: controller.signal })); await flush()
    if (action === 'reset') app.reset()
    if (action === 'dispose') app.dispose()
    if (action === 'abort') controller.abort()
    if (action === 'input-limit') expect((await app.update('oversized')).status).toBe('input-limit')
    expect(await pending).toBe(action === 'dispose' ? 'DISPOSED' : action === 'input-limit' ? 'SUPERSEDED' : 'ABORTED')
    expect(signal.aborted).toBe(true)
    const late = backend(); finish(late); await flush()
    expect(late.dispose).toHaveBeenCalledTimes(1); expect(late.update).not.toHaveBeenCalled()
  })
  it('retains the initial setup deadline despite newer queued requests', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
    const app = application({ createFallback: () => new Promise(() => {}) })
    const first = rejected(app.update('first', { timeoutMs: 10 })); await flush()
    const second = app.update('second', { timeoutMs: 100 })
    expect(await first).toBe('SUPERSEDED'); await vi.advanceTimersByTimeAsync(10)
    expect(await second).toMatchObject({ status: 'error', error: { code: 'TIMEOUT' } })
    expect(vi.getTimerCount()).toBe(0)
  })
  it('discards synchronous results after a deadline without retrying work', async () => {
    const session = backend(), app = application({ createFallback: () => session })
    const normal = performance.now.bind(performance)
    let clock: ReturnType<typeof vi.spyOn>
    session.update = vi.fn(() => { clock = vi.spyOn(performance, 'now').mockReturnValue(normal() + 1000); return result() })
    try { expect(await app.update('text', { timeoutMs: 10 })).toMatchObject({ status: 'error', error: { code: 'TIMEOUT' } }) }
    finally { clock!.mockRestore() }
    expect(session.update).toHaveBeenCalledTimes(1); expect(session.dispose).toHaveBeenCalledTimes(1)
  })
  it('retires idle synchronous state and clears timers on disposal', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const sessions: ReturnType<typeof backend>[] = []
    const app = application({ idleTimeoutMs: 10, createFallback: () => { const session = backend(); sessions.push(session); return session } })
    await app.update('first'); await vi.advanceTimersByTimeAsync(10)
    expect(sessions[0].dispose).toHaveBeenCalledTimes(1)
    await app.update('second'); app.dispose()
    expect(sessions[1].dispose).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0)
  })
  it('releases synchronous state after a queue limit and recovers on a smaller edit', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const sessions: ReturnType<typeof backend>[] = []
    const app = application({ maxPendingCodeUnits: 5, createFallback: () => { const session = backend(); sessions.push(session); return session } })
    await app.update('first')
    expect(vi.getTimerCount()).toBe(1)
    expect(await app.update('too long')).toMatchObject({ status: 'error', error: { code: 'QUEUE_FULL' } })
    expect(sessions[0].dispose).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0)
    expect(await app.update('next')).toMatchObject({ status: 'ready' })
    expect(sessions).toHaveLength(2)
  })
  it('does not commit reentrant synchronous results after reset', async () => {
    const session = backend(), app = application({ createFallback: () => session })
    session.update = vi.fn(() => { app.reset(); return result('stale') })
    expect(await rejected(app.update('text'))).toBe('ABORTED')
    expect(app.metrics.pending).toBe(false)
  })
  it('does not attribute an abandoned factory error to a reentrant update', async () => {
    let attempts = 0, next: Promise<unknown> | undefined
    const app = application({ createFallback: (_configuration, signal) => {
      if (++attempts === 1) { signal.addEventListener('abort', () => { next = app.update('new') }); throw Error('setup failed') }
      return backend()
    } })
    expect(await rejected(app.update('old'))).toBe('SUPERSEDED')
    expect(await next).toMatchObject({ status: 'ready', result: { html: '<p>new</p>\n' } })
  })
})

describe('application worker mode', () => {
  it('preserves warm worker state and coalesces pending edits', async () => {
    const worker = new WorkerTransport(), createWorker = vi.fn(() => worker), createFallback = vi.fn(() => backend())
    const app = application({ createWorker, createFallback })
    await app.update('warm'); worker.auto = false
    const old = rejected(app.update('old')); await flush()
    const skipped = rejected(app.update('skipped')), latest = app.update('latest')
    expect(await old).toBe('SUPERSEDED'); expect(await skipped).toBe('SUPERSEDED')
    worker.send(worker.handler.handle(worker.messages.at(-1))); await flush()
    expect(worker.messages.at(-1).source).toBe('latest')
    worker.send(worker.handler.handle(worker.messages.at(-1)))
    expect(await latest).toMatchObject({ status: 'ready', result: { html: '<p>latest</p>\n' } })
    expect(createWorker).toHaveBeenCalledTimes(1); expect(createFallback).not.toHaveBeenCalled()
    app.dispose(); expect(worker.disposed).toBe(true)
  })
  it('does not retry worker failures through the fallback', async () => {
    const createFallback = vi.fn(() => backend()), createWorker = vi.fn(() => { throw Error('worker failure') })
    const app = application({ createWorker, createFallback })
    expect(await app.update('text')).toMatchObject({ status: 'error', error: { code: 'WORKER_ERROR' } })
    expect(createFallback).not.toHaveBeenCalled(); expect(createWorker).toHaveBeenCalledTimes(1)
  })
  it('input limits release active workers and a smaller edit recovers', async () => {
    const workers: WorkerTransport[] = []
    const app = application({ limits: { maxInputLength: 5 }, createWorker: () => { const worker = new WorkerTransport(); workers.push(worker); return worker } })
    await app.update('short'); const old = workers[0]; old.auto = false
    const pending = rejected(app.update('wait')); await flush()
    expect(await app.update('oversized')).toMatchObject({ status: 'input-limit' }); expect(await pending).toBe('SUPERSEDED')
    expect(old.disposed).toBe(true)
    expect(await app.update('small')).toMatchObject({ status: 'ready' }); expect(workers).toHaveLength(2)
  })
  it.each(['abort', 'timeout', 'reset', 'dispose'] as const)('releases active work on %s', async action => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
    const worker = new WorkerTransport(), app = application({ createWorker: () => worker })
    await app.update('warm'); worker.auto = false
    const controller = new AbortController(), pending = app.update('blocked', { signal: controller.signal, timeoutMs: 10 })
    const outcome = pending.catch(error => error.code); await flush()
    if (action === 'abort') controller.abort()
    if (action === 'timeout') await vi.advanceTimersByTimeAsync(10)
    if (action === 'reset') app.reset()
    if (action === 'dispose') app.dispose()
    if (action === 'timeout') expect(await outcome).toMatchObject({ status: 'error', error: { code: 'TIMEOUT' } })
    else expect(await outcome).toBe(action === 'dispose' ? 'DISPOSED' : 'ABORTED')
    expect(worker.disposed).toBe(true); expect(vi.getTimerCount()).toBe(0)
  })
})

describe('bounded synchronous backend', () => {
  it('preserves parity, declarations, and callback counts across rotations', () => {
    let calls = 0
    const plugins = [defineIncrementalPlugin(tocPlugin(), { protocol: 1, id: 'toc', profile: 'render' }), defineIncrementalPlugin(builder => builder.addHtmlTransform(html => { calls++; return html }), { protocol: 1, id: 'count', profile: 'render' })]
    const session = createMarkdownSynchronousSession({ parser: { plugins }, pluginReuse: 'declared', maxUpdates: 2 })
    for (let i = 0; i < 8; i++) { const text = '# Heading\n\nStable text\n\n' + i; expect(session.update(text)).toEqual(createParser({ plugins: [plugins[0]] }).parseDocument(text)) }
    expect(calls).toBe(8); session.dispose(); session.dispose()
    expect(() => session.update('closed')).toThrowError(MarkdownApplicationError)
  })
  it('rejects reentrancy and disposal during synchronous setup', () => {
    for (const action of ['reentrant', 'dispose']) {
      let session: MarkdownSynchronousSession
      session = createMarkdownSynchronousSession({ parser: { plugins: [() => { if (action === 'dispose') session.dispose(); else session.update('nested') }] } })
      expect(() => session.update('outer')).toThrow(action === 'dispose' ? 'disposed' : 'reentrant')
      session.dispose()
    }
  })
  it('distinguishes input and work limits from unrelated callback errors', () => {
    for (const [configuration, code] of [[{ maxInputLength: 1 }, 'INPUT_LIMIT'], [{ maxWorkCodeUnits: 1 }, 'WORK_LIMIT']] as const) {
      const session = createMarkdownSynchronousSession(configuration)
      expect(() => session.update('long')).toThrowError(expect.objectContaining({ code }))
      session.dispose()
    }
    const error = new RangeError('plugin')
    const session = createMarkdownSynchronousSession({ parser: { plugins: [builder => builder.addHtmlTransform(() => { throw error })] } })
    expect(() => session.update('text')).toThrow(error); session.dispose()
  })
})
