import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMarkdownWorkerClient, type MarkdownWorkerRequest, type MarkdownWorkerTransport } from '../../src/experimental/worker-client.js'
import { createMarkdownWorkerHandler, installMarkdownWorker, type MarkdownWorkerOptions } from '../../src/experimental/worker.js'
import { MARKDOWN_WORKER_PROTOCOL as protocol, copyConfiguration, defaultLimits, htmlDelta, applyHtmlDelta, type MarkdownWorkerResponse } from '../../src/experimental/worker/protocol.js'
import { createParser } from '../../src/index.js'
import { defineIncrementalPlugin } from '../../src/experimental/index.js'
import { tocPlugin } from '../../src/plugins/toc.js'

const open = (id = 1, configuration: unknown = null, limits = defaultLimits) => ({ protocol, type: 'open', id, configuration, limits })
const update = (id = 2, source = 'hello', revision = id - 1) => ({ protocol, type: 'update', id, revision, source })
const disposals: (() => void)[] = []
afterEach(() => { disposals.splice(0).forEach(dispose => dispose()); vi.useRealTimers() })
class Transport {
  listeners = new Map<string, Set<(event: any) => void>>()
  messages: MarkdownWorkerRequest[] = []
  responses: MarkdownWorkerResponse[] = []
  terminated = 0
  auto = true
  handler: ReturnType<typeof createMarkdownWorkerHandler>
  constructor(options?: MarkdownWorkerOptions) { this.handler = createMarkdownWorkerHandler(options) }
  addEventListener(type: string, listener: (event: any) => void) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type)!.add(listener) }
  removeEventListener(type: string, listener: (event: any) => void) { this.listeners.get(type)?.delete(listener) }
  postMessage(message: MarkdownWorkerRequest) {
    this.messages.push(structuredClone(message))
    if (this.auto) this.reply(this.handler.handle(structuredClone(message)))
  }
  reply(data: unknown) { this.responses.push(data as MarkdownWorkerResponse); this.emit('message', { data: structuredClone(data) }) }
  emit(type: string, event = {}) { for (const listener of [...this.listeners.get(type) ?? []]) listener(event) }
  terminate() { this.terminated++; this.handler.dispose() }
  get listenerCount() { return [...this.listeners.values()].reduce((n, listeners) => n + listeners.size, 0) }
}
const flush = async () => { for (let n = 0; n < 6; n++) await Promise.resolve() }
function fixture(options: Parameters<typeof createMarkdownWorkerClient>[0] extends infer T ? Partial<T> : never = {}, workerOptions?: MarkdownWorkerOptions) {
  const workers: Transport[] = []
  const client = createMarkdownWorkerClient({ createWorker: () => { const worker = new Transport(workerOptions); workers.push(worker); return worker as MarkdownWorkerTransport }, ...options })
  disposals.push(() => client.dispose())
  return { client, workers }
}
const code = (promise: Promise<unknown>) => promise.then(() => 'success', error => error.code)

describe('Markdown worker configuration boundary', () => {
  it('copies nested JSON data and freezes it without freezing caller input', () => {
    const input = { list: [true, null, 3, { mode: 'safe' }] }
    const result = copyConfiguration(input) as typeof input
    input.list.push(false)
    expect(result.list).toHaveLength(4)
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.list)).toBe(true)
    expect(Object.isFrozen(result.list[3])).toBe(true)
    expect(Object.getPrototypeOf(result)).toBe(null)
  })
  it.each([undefined, () => {}, NaN, Infinity, new Date(), new Map(), Symbol(), [ , 1], Object.assign([], { extra: 1 })])('rejects non-JSON values: %s', value => {
    expect(() => copyConfiguration(value)).toThrow()
  })
  it('rejects accessors without reading them, symbols, cycles, and nonenumerable fields', () => {
    const get = vi.fn(), cyclic: any = {}; cyclic.self = cyclic
    for (const value of [{ get value() { return get() } }, { [Symbol()]: true }, cyclic, Object.defineProperty({}, 'hidden', { value: 1 })]) expect(() => copyConfiguration(value)).toThrow()
    expect(get).not.toHaveBeenCalled()
  })
  it.each(['x'.repeat(16_385), Array(1025).fill(0), Object.fromEntries(Array.from({ length: 1025 }, (_, i) => [i, 0])), Array.from({length: 18}).reduce(value => [value], [] as unknown[])])('bounds configuration size and depth', value => {
    expect(() => copyConfiguration(value)).toThrow(RangeError)
  })
})

describe('Markdown worker handler', () => {
  it('preserves document parity, plugin declarations, and callback counts across rotations', () => {
    let renders = 0
    const plugins = [defineIncrementalPlugin(tocPlugin(), { protocol: 1, profile: 'render', id: 'toc' }),
      defineIncrementalPlugin(builder => builder.addHtmlTransform(html => { renders++; return html }), { protocol: 1, profile: 'render', id: 'count' })]
    const handler = createMarkdownWorkerHandler({ maxUpdates: 2, configure: () => ({ session: { parser: { plugins }, pluginReuse: 'declared' } }) })
    expect(handler.handle(open()).type).toBe('ready')
    const parser = createParser({ plugins: [plugins[0]] })
    for (let i = 0; i < 6; i++) {
      const source = '# Heading\n\nStable paragraph.\n\n[ref][id]\n\n[id]: /' + i
      const response = handler.handle(update(i + 2, source))
      expect(response.type).toBe('result')
      if (response.type !== 'result') throw response
      expect(response.result).toEqual(parser.parseDocument(source))
      expect(response.metrics.sessionGeneration).toBe(Math.floor(i / 2) + 1)
      if (i % 2) expect(response.metrics.reusedBlockCodeUnits).toBeGreaterThan(0)
    }
    expect(renders).toBe(6)
    handler.dispose(); handler.dispose()
    expect(handler.handle(update(8))).toMatchObject({ type: 'error', error: { code: 'PROTOCOL_ERROR' } })
  })
  it('combines worker, client, and parser ceilings and recovers after oversized input', () => {
    const handler = createMarkdownWorkerHandler({ limits: { maxInputLength: 20 }, configure: () => ({ session: { parser: { maxInputLength: 8 } } }) })
    expect(handler.handle(open(1, null, { ...defaultLimits, maxInputLength: 10 }))).toMatchObject({ limits: { maxInputLength: 8 } })
    expect(handler.handle(update(2, 'x'.repeat(9)))).toMatchObject({ error: { code: 'INPUT_LIMIT' } })
    expect(handler.handle(update(3, 'short'))).toMatchObject({ type: 'result' })
  })
  it('releases a failed render without retrying it', () => {
    let calls = 0
    const handler = createMarkdownWorkerHandler({ configure: () => ({ session: { parser: { plugins: [builder => builder.addHtmlTransform(html => { if (++calls === 1) throw new RangeError('plugin failure'); return html })] } } }) })
    handler.handle(open())
    expect(handler.handle(update())).toMatchObject({ error: { code: 'RENDER_ERROR', message: 'plugin failure' } })
    expect(calls).toBe(1)
    expect(handler.handle(update(3))).toMatchObject({ type: 'result', metrics: { sessionGeneration: 2 } })
    expect(calls).toBe(2)
  })
  it('stops reentrant configuration without running a parse', () => {
    let handler: ReturnType<typeof createMarkdownWorkerHandler>
    const configure = vi.fn(() => { handler.handle(open(2)); return {} })
    handler = createMarkdownWorkerHandler({ configure })
    expect(handler.handle(open())).toMatchObject({ error: { code: 'CONFIGURATION_ERROR' } })
    expect(configure).toHaveBeenCalledTimes(1)
    expect(handler.handle(update(3))).toMatchObject({ error: { code: 'PROTOCOL_ERROR' } })
  })
  it('enforces output and work ceilings without automatic retry', () => {
    for (const [options, expected] of [[{ limits: { maxResultCodeUnits: 3 } }, 'OUTPUT_LIMIT'], [{ maxWorkCodeUnits: 1 }, 'WORK_LIMIT']] as const) {
      const handler = createMarkdownWorkerHandler(options)
      handler.handle(open())
      expect(handler.handle(update())).toMatchObject({ error: { code: expected } })
    }
  })
  it('rotates before cumulative exhaustion', () => {
    const handler = createMarkdownWorkerHandler({ maxWorkCodeUnits: 1000 })
    handler.handle(open())
    let rotations = 0
    for (let i = 2; i < 102; i++) {
      const response = handler.handle(update(i))
      expect(response.type).toBe('result')
      if (response.type === 'result') { expect(response.metrics.workCodeUnits).toBeLessThanOrEqual(1000); rotations = response.metrics.sessionRotations }
    }
    expect(rotations).toBeGreaterThan(0)
  })
  it.each([open(), update(1), { ...update(3), revision: 0 }, { ...update(3), revision: 1 }, { ...update(3), source: 1 }, { ...update(3), protocol: 'other' }])('closes after replay or malformed requests', request => {
    const handler = createMarkdownWorkerHandler(); handler.handle(open()); handler.handle(update())
    expect(handler.handle(request)).toMatchObject({ error: { code: 'PROTOCOL_ERROR' } })
    expect(handler.handle(update(4))).toMatchObject({ error: { code: 'PROTOCOL_ERROR' } })
  })
  it('rejects configuration errors and rejected async factories without unhandled rejections', async () => {
    const handler = createMarkdownWorkerHandler({ configure: (() => Promise.reject(new Error('async'))) as never })
    expect(handler.handle(open())).toMatchObject({ error: { code: 'CONFIGURATION_ERROR' } })
    await flush()
    expect(createMarkdownWorkerHandler().handle({ ...open(), limits: {} })).toMatchObject({ error: { code: 'CONFIGURATION_ERROR' } })
  })
  it('cleans installation on post failure and registration failure', () => {
    const scope = new Transport()
    scope.postMessage = () => { throw new Error('post') }
    const dispose = installMarkdownWorker(scope as never)
    expect(() => scope.emit('message', { data: open() })).toThrow('post')
    expect(scope.listenerCount).toBe(0); dispose()
    scope.addEventListener = (type, listener) => { scope.listeners.set(type, new Set([listener])); throw new Error('add') }
    expect(() => installMarkdownWorker(scope as never)).toThrow('add')
    expect(scope.listenerCount).toBe(0)
  })
})

describe('Markdown worker client lifecycle', () => {
  it('starts lazily, copies configuration, and returns complete frozen results', async () => {
    const configuration = { title: 'original' }
    const configure = vi.fn(() => ({}))
    const { client, workers } = fixture({ configuration }, { configure })
    expect(workers).toHaveLength(0); configuration.title = 'changed'
    const output = await client.update('# Hello')
    expect(configure).toHaveBeenCalledWith({ title: 'original' })
    expect(output.result.html).toBe('<h1>Hello</h1>\n')
    expect(Object.isFrozen(output)).toBe(true); expect(Object.isFrozen(output.result.toc)).toBe(true)
    expect(output.totalMs).toBeGreaterThanOrEqual(output.roundTripMs)
    expect(client.metrics).toMatchObject({ workerStarts: 1, pendingCount: 0, pendingCodeUnits: 0, completedUpdates: 1 })
    client.dispose(); expect(workers[0].listenerCount).toBe(0); expect(workers[0].terminated).toBe(1)
    expect(await code(client.update('later'))).toBe('DISPOSED')
  })
  it('coalesces edits before startup', async () => {
    const { client, workers } = fixture()
    const first = code(client.update('first')), second = code(client.update('second')), third = client.update('third')
    expect(await first).toBe('SUPERSEDED'); expect(await second).toBe('SUPERSEDED')
    expect((await third).revision).toBe(3)
    expect(workers[0].messages.map(m => m.type)).toEqual(['open', 'update'])
    expect(workers[0].messages[1]).toMatchObject({ source: 'third' })
  })
  it('drains active superseded work and parses only the latest queued edit', async () => {
    const { client, workers } = fixture(); await client.update('warm')
    const worker = workers[0]; worker.auto = false
    const old = code(client.update('old')); await flush()
    const skipped = code(client.update('skipped')), latest = client.update('latest')
    expect(await old).toBe('SUPERSEDED'); expect(await skipped).toBe('SUPERSEDED')
    expect(client.metrics.pendingCount).toBe(2)
    worker.reply(worker.handler.handle(worker.messages.at(-1)))
    await flush()
    expect(worker.messages.at(-1)).toMatchObject({ source: 'latest' })
    worker.reply(worker.handler.handle(worker.messages.at(-1)))
    expect((await latest).result.html).toBe('<p>latest</p>\n')
    expect(worker.messages.some(m => m.type === 'update' && m.source === 'skipped')).toBe(false)
    expect(client.metrics.workerStarts).toBe(1)
  })
  it('enforces queue/input bounds without superseding accepted work', async () => {
    const { client, workers } = fixture({ maxPendingCodeUnits: 10, limits: { maxInputLength: 8 } }); await client.update('warm'); workers[0].auto = false
    const active = client.update('123456'); await flush()
    expect(await code(client.update('12345'))).toBe('QUEUE_FULL')
    expect(await code(client.update('123456789'))).toBe('INPUT_LIMIT')
    workers[0].reply(workers[0].handler.handle(workers[0].messages.at(-1)))
    expect((await active).result.html).toContain('123456')
  })
  it.each(['active', 'queued', 'startup'] as const)('aborts %s work and recovers on a later edit', async mode => {
    const worker = new Transport(); worker.auto = false
    const { client } = fixture({ createWorker: () => worker })
    const controller = new AbortController(), promise = code(client.update('source', { signal: controller.signal }))
    if (mode !== 'queued') await flush()
    if (mode === 'active') { worker.reply(worker.handler.handle(worker.messages[0])); await flush() }
    controller.abort()
    expect(await promise).toBe('ABORTED')
    expect(client.metrics.pendingCount).toBe(0)
    expect(worker.terminated).toBe(mode === 'queued' ? 0 : 1)
    expect(worker.listenerCount).toBe(0)
  })
  it('does not terminate active work when a queued request is aborted', async () => {
    const { client, workers } = fixture(); await client.update('warm'); const worker = workers[0]; worker.auto = false
    const old = code(client.update('old')); await flush()
    const controller = new AbortController(), queued = code(client.update('queue', { signal: controller.signal }))
    controller.abort(); expect(await queued).toBe('ABORTED'); expect(await old).toBe('SUPERSEDED')
    expect(worker.terminated).toBe(0)
    worker.reply(worker.handler.handle(worker.messages.at(-1))); await flush()
    expect(client.metrics.pendingCount).toBe(0)
  })
  it.each(['startup', 'active'] as const)('enforces %s deadlines and ignores late events', async mode => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
    const workers: Transport[] = []
    const { client } = fixture({ timeoutMs: 20, createWorker: () => { const w = new Transport(); w.auto = false; workers.push(w); return w } })
    const first = code(client.update('first')); await flush()
    const worker = workers[0], late = [...worker.listeners.get('message')!][0]
    if (mode === 'active') { worker.reply(worker.handler.handle(worker.messages[0])); await flush() }
    await vi.advanceTimersByTimeAsync(20)
    expect(await first).toBe('TIMEOUT'); expect(worker.terminated).toBe(1)
    const second = client.update('second'); await flush()
    late({ data: { protocol, type: 'result', id: 2, revision: 1 } })
    workers[1].auto = true; workers[1].reply(workers[1].handler.handle(workers[1].messages[0]))
    expect((await second).result.html).toContain('second')
  })
  it('honors a longer per-call deadline during startup', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
    const worker = new Transport(); worker.auto = false
    const { client } = fixture({ timeoutMs: 10, createWorker: () => worker })
    const pending = client.update('longer', { timeoutMs: 100 }); await flush()
    await vi.advanceTimersByTimeAsync(20)
    expect(worker.terminated).toBe(0)
    worker.auto = true; worker.reply(worker.handler.handle(worker.messages[0]))
    expect((await pending).result.html).toContain('longer')
  })
  it('checks elapsed deadlines even before timer delivery', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { client, workers } = fixture(); await client.update('warm'); workers[0].auto = false
    const pending = code(client.update('late', { timeoutMs: 10 })); await flush()
    const clock = vi.spyOn(performance, 'now').mockReturnValue(performance.now() + 100)
    try { workers[0].reply(workers[0].handler.handle(workers[0].messages.at(-1))) } finally { clock.mockRestore() }
    expect(await pending).toBe('TIMEOUT'); expect(workers[0].terminated).toBe(1)
  })
  it('terminates superseded active work at its deadline and starts only the queued revision', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
    const { client, workers } = fixture({ timeoutMs: 100 }); await client.update('warm'); workers[0].auto = false
    const old = code(client.update('old', { timeoutMs: 10 })); await flush()
    const latest = client.update('latest'); expect(await old).toBe('SUPERSEDED')
    await vi.advanceTimersByTimeAsync(10)
    expect((await latest).revision).toBe(3)
    expect(workers[0].terminated).toBe(1); expect(workers).toHaveLength(2)
  })
  it.each(['error', 'messageerror', 'post', 'malformed', 'future-id', 'revision', 'limits', 'output'] as const)('settles transport failure: %s', async failure => {
    const { client, workers } = fixture(); await client.update('warm'); const worker = workers[0]; worker.auto = false
    if (failure === 'post') worker.postMessage = () => { throw new Error('post') }
    const pending = code(client.update('next')); await flush()
    const request = worker.messages.at(-1)!
    if (failure === 'error' || failure === 'messageerror') worker.emit(failure)
    if (failure === 'malformed') worker.reply(null)
    if (failure === 'future-id') worker.reply({ protocol, id: 999 })
    if (failure === 'revision') worker.reply({ protocol, id: request.id, revision: 999, type: 'result' })
    if (failure === 'limits') worker.reply({ protocol, id: request.id, revision: 2, type: 'ready', limits: {} })
    if (failure === 'output') {
      const response = worker.handler.handle(request)
      if (response.type === 'result') response.result = { ...response.result, html: 'x'.repeat(2_000_001) }
      worker.reply(response)
    }
    expect(await pending).toBe(failure === 'output' ? 'OUTPUT_LIMIT' : ['error', 'messageerror', 'post'].includes(failure) ? 'WORKER_ERROR' : 'PROTOCOL_ERROR')
    expect(worker.terminated).toBe(1); expect(worker.listenerCount).toBe(0)
    expect((await client.update('recovery')).result.html).toContain('recovery')
  })
  it('rejects missing handshake limits', async () => {
    const worker = new Transport(); worker.auto = false
    const { client } = fixture({ createWorker: () => worker })
    const pending = code(client.update('text')); await flush()
    worker.reply({ protocol, type: 'ready', id: 1, limits: {} })
    expect(await pending).toBe('PROTOCOL_ERROR')
  })
  it('cleans timers and listeners on idle retirement and disposal', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { client, workers } = fixture({ idleTimeoutMs: 10 })
    await client.update('ready'); await flush(); await vi.advanceTimersByTimeAsync(10)
    expect(workers[0].terminated).toBe(1); expect(workers[0].listenerCount).toBe(0)
    await client.update('again'); client.dispose(); client.dispose()
    expect(workers[1].terminated).toBe(1); expect(vi.getTimerCount()).toBe(0)
  })
  it.each(['factory', 'registration', 'error-during-registration'] as const)('handles reentrant disposal or registration failure: %s', async mode => {
    const worker = new Transport()
    const original = worker.addEventListener.bind(worker)
    let client: ReturnType<typeof createMarkdownWorkerClient>
    if (mode !== 'factory') worker.addEventListener = (type, listener) => {
      original(type, listener)
      if (type === 'error') { if (mode === 'registration') throw new Error('registration'); worker.emit('error') }
    }
    client = createMarkdownWorkerClient({ createWorker: () => { if (mode === 'factory') client.dispose(); return worker } })
    disposals.push(() => client.dispose())
    expect(await code(client.update('text'))).toBe(mode === 'factory' ? 'DISPOSED' : 'WORKER_ERROR')
    expect(worker.terminated).toBe(1); expect(worker.listenerCount).toBe(0)
  })
})


describe('negotiated HTML delta transport', () => {
  const source = '# Retained heading\n\n' + 'stable text & 😀 '.repeat(100)
  it('preserves complete results across edits, parser rotations, and final sanitization', async () => {
    let calls = 0
    const sanitizer = (html: string) => { calls++; return html.replaceAll('unsafe', 'safe') }
    const parser = createParser({ allowHtml: true, sanitize: true, sanitizer })
    const { client, workers } = fixture({ htmlDeltas: true }, { maxUpdates: 2,
      configure: () => ({ session: { parser: { allowHtml: true, sanitize: true, sanitizer } } }) })
    for (const next of [source, source + 'unsafe', source + 'unsafe changed', source + 'unsafe changed <b>unsafe</b>', 'short']) {
      const expected = parser.parseDocument(next), before = calls
      expect((await client.update(next)).result).toEqual(expected)
      expect(calls - before).toBe(1)
    }
    const replies = workers[0].responses
    expect(replies[0]).toMatchObject({ type: 'ready', htmlDeltas: true })
    expect(replies.filter(reply => reply.type === 'html-delta')).toHaveLength(3)
    for (const reply of replies) if (reply.type === 'html-delta') {
      expect(reply.result).not.toHaveProperty('html')
      expect(reply.delta.insert.length).toBeLessThan(100)
    }
  })
  it('keeps the existing full-response protocol unless both ends opt in', async () => {
    const { client, workers } = fixture()
    await client.update(source); await client.update(source + 'tail')
    expect(workers[0].responses.map(reply => reply.type)).toEqual(['ready', 'result', 'result'])
    const old = new Transport()
    const post = old.postMessage.bind(old)
    old.postMessage = message => { const request = { ...message }; if (request.type === 'open') delete request.htmlDeltas; post(request) }
    const compatible = createMarkdownWorkerClient({ createWorker: () => old, htmlDeltas: true })
    disposals.push(() => compatible.dispose())
    await compatible.update(source); await compatible.update(source + 'tail')
    expect(old.responses.map(reply => reply.type)).toEqual(['ready', 'result', 'result'])
  })
  it('falls back to a full result after a superseded delta without retaining its graph', async () => {
    const { client, workers } = fixture({ htmlDeltas: true })
    await client.update(source)
    const worker = workers[0]; worker.auto = false
    const pending = code(client.update(source + 'obsolete')); await flush()
    const latest = client.update(source + 'latest')
    expect(await pending).toBe('SUPERSEDED')
    const obsolete = worker.handler.handle(worker.messages.at(-1))
    expect(obsolete.type).toBe('html-delta')
    worker.reply(obsolete); await flush()
    expect(worker.messages.at(-1)).toMatchObject({ htmlBaseRevision: 1 })
    const response = worker.handler.handle(worker.messages.at(-1))
    expect(response.type).toBe('result')
    worker.reply(response)
    expect((await latest).result.html).toBe(createParser().parse(source + 'latest'))
  })
  it('rejects mismatched bases and reconstructs within output limits', async () => {
    const { client, workers } = fixture({ htmlDeltas: true })
    await client.update(source)
    const worker = workers[0]; worker.auto = false
    const pending = code(client.update(source + 'next')); await flush()
    const response = worker.handler.handle(worker.messages.at(-1))
    if (response.type !== 'html-delta') throw response
    worker.reply({ ...response, delta: { ...response.delta, baseRevision: 99 } })
    expect(await pending).toBe('PROTOCOL_ERROR'); expect(worker.terminated).toBe(1)
    const base = { revision: 1, html: 'a'.repeat(200) }
    expect(() => applyHtmlDelta({ baseRevision: 1, start: 0, deleteCount: 0, insert: 'x' }, base, 200)).toThrow(/maxResultCodeUnits/)
    for (const bad of [{ start: -1 }, { start: 201 }, { deleteCount: 201 }, { insert: 7 }, { baseRevision: 0 }]) {
      expect(() => applyHtmlDelta({ baseRevision: 1, start: 0, deleteCount: 0, insert: '', ...bad }, base, 200)).toThrow()
    }
  })
  it('reconstructs arbitrary UTF-16 edits exactly with bounded retained bases', () => {
    let before = 'fixed prefix '.repeat(50) + '😀&<>'
    for (let i = 0; i < 1000; i++) {
      const at = (i * 197) % before.length
      const after = before.slice(0, at) + String.fromCharCode(i) + before.slice(at + 1)
      const delta = htmlDelta(before, after, i + 1)
      expect(delta).toBeDefined()
      expect(applyHtmlDelta(delta, { revision: i + 1, html: before }, 2000)).toBe(after)
      before = after
    }
  })
  it('clears retained bases after errors, retirement, and recreation', async () => {
    const { client, workers } = fixture({ htmlDeltas: true }, { limits: { maxInputLength: 2000 } })
    await client.update(source)
    const worker = workers[0]; worker.auto = false
    const pending = code(client.update(source + 'tail')); await flush()
    worker.reply({ protocol, type: 'error', id: worker.messages.at(-1)!.id, revision: 2,
      error: { code: 'RENDER_ERROR', name: 'Error', message: 'failed' } })
    expect(await pending).toBe('RENDER_ERROR')
    worker.auto = true
    await client.update(source + 'recovered')
    expect(worker.messages.at(-1)).not.toHaveProperty('htmlBaseRevision')
  })
})
