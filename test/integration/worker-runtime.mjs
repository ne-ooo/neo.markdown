import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { Worker } from 'node:worker_threads'
import { createRequire } from 'node:module'
import { parserOptions } from './worker-fixture.mjs'
const require = createRequire(import.meta.url)
const load = specifier => process.env.NEO_INTEGRATION_FORMAT === 'cjs' ? require(specifier) : import(specifier)
const { createMarkdownWorkerClient } = await load('@lpm.dev/neo.markdown/experimental/worker-client')
const { createParser } = await load('@lpm.dev/neo.markdown')
const source = '# Heading\n\n# Heading\n\n[link][ref] and 😀 café\n\n- one\n- two\n\n| A | B |\n| - | - |\n| x | y |\n\n```js filename=api.js diff focus=2 mark="2:7-2:8"\n- const x = 1;\n+ const x = 2;\n```\n\n```python mark="1:0-1:2"\nf"{value}"\n```\n\n<script>bad()</script>\n\n[ref]: /one\n'
function setup(options = {}, workerData) {
  const workers = []
  const client = createMarkdownWorkerClient({ timeoutMs: 10_000, idleTimeoutMs: 0, ...options, createWorker() {
    const native = new Worker(new URL('./worker-fixture.mjs', import.meta.url), { workerData })
    const entry = { native, terminated: false, listeners: new Map(), entered: null }
    entry.entered = new Promise(resolve => { entry.onEnter = resolve })
    workers.push(entry)
    return {
      postMessage: message => native.postMessage(message),
      terminate() { entry.terminated = true; return native.terminate() },
      addEventListener(type, listener) {
        const wrapped = data => { if (data?.test === 'entered') { entry.onEnter(); return }; listener(type === 'message' ? { data } : data) }
        entry.listeners.set(listener, wrapped); native.on(type, wrapped)
      },
      removeEventListener(type, listener) { native.off(type, entry.listeners.get(listener)); entry.listeners.delete(listener) },
    }
  } })
  return { client, workers }
}
test('native worker results match complete CommonMark and GFM fixture parsing', async () => {
  const { client } = setup(), parser = createParser(parserOptions())
  try {
    const fixtures = JSON.parse(await readFile(new URL('./dom-fixtures.json', import.meta.url), 'utf8'))
    for (const fixture of fixtures) assert.deepEqual((await client.update(fixture.markdown)).result, parser.parseDocument(fixture.markdown), String(fixture.example))
  } finally { client.dispose() }
})
test('built plugin declarations retain reuse across formats and return complete assets and diagnostics', async () => {
  const { client } = setup({}, { maxUpdates: 2 }), parser = createParser(parserOptions())
  try {
    for (let i = 0; i < 6; i++) {
      const text = source.replace('/one', '/' + i), output = await client.update(text)
      assert.deepEqual(output.result, parser.parseDocument(text))
      assert.ok(Object.isFrozen(output.result.stylesheets[0])); assert.ok(Object.isFrozen(output.result.diagnostics[0].codeBlock))
      assert.ok(output.result.stylesheets.length >= 3); assert.ok(output.result.diagnostics.length > 0); assert.equal(output.result.toc.length, 2)
      assert.doesNotMatch(output.result.html, /<script/)
      assert.equal(output.metrics.sessionGeneration, Math.floor(i / 2) + 1)
      if (i % 2) assert.ok(output.metrics.reusedBlockCodeUnits > 0, 'declaration must survive the worker entry boundary')
    }
  } finally { client.dispose() }
})
test('native streamed prefixes preserve Unicode and complete document parity', async () => {
  const { client } = setup(), parser = createParser(parserOptions())
  try {
    for (let end = 0; end <= source.length; end++) assert.deepEqual((await client.update(source.slice(0, end))).result, parser.parseDocument(source.slice(0, end)))
  } finally { client.dispose() }
})
test('embedded blocks retain complete-parser fallback and sanitization', async () => {
  const { client } = setup({ configuration: { embeds: true } }), parser = createParser(parserOptions({ embeds: true }))
  try {
    const text = source + '\n::youtube[dQw4w9WgXcQ]\n'
    const output = await client.update(text)
    assert.deepEqual(output.result, parser.parseDocument(text))
    assert.match(output.result.html, /embed/)
    assert.equal((await client.update(text)).metrics.reusedBlockCodeUnits, 0)
  } finally { client.dispose() }
})
test('abort terminates a blocked native worker and the next edit recovers', async () => {
  const { client, workers } = setup({ configuration: { block: true } }, { block: true })
  try {
    await client.update('warm')
    const controller = new AbortController()
    const result = client.update('BLOCK', { signal: controller.signal })
    const rejected = assert.rejects(result, { code: 'ABORTED' })
    await workers[0].entered; controller.abort(); await rejected
    assert.equal(workers[0].terminated, true); assert.equal(workers[0].listeners.size, 0)
    assert.match((await client.update('recovery')).result.html, /recovery/)
    assert.equal(workers.length, 2)
  } finally { client.dispose() }
})
test('deadline terminates blocked superseded work and starts only the latest queued revision', async () => {
  const { client, workers } = setup({ configuration: { block: true } }, { block: true })
  try {
    await client.update('warm')
    const pending = client.update('BLOCK', { timeoutMs: 500 })
    const rejected = assert.rejects(pending, { code: 'SUPERSEDED' })
    await workers[0].entered
    const latest = client.update('latest'); await rejected
    assert.match((await latest).result.html, /latest/)
    assert.equal(workers[0].terminated, true)
    assert.equal(client.metrics.workerStarts, 2)
  } finally { client.dispose() }
})

test('native HTML deltas return complete assets and sanitized output across session rotations', async () => {
  const { client, workers } = setup({ htmlDeltas: true }, { maxUpdates: 2 }), parser = createParser(parserOptions())
  const responses=[]
  try {
    const first=await client.update(source)
    assert.deepEqual(first.result,parser.parseDocument(source))
    workers[0].native.on('message',response=>responses.push(response))
    for(let i=0;i<20;i++) {
      const text=source+'\nTail '+i+' 😀'
      assert.deepEqual((await client.update(text)).result,parser.parseDocument(text))
    }
    assert.equal(responses.filter(response=>response.type==='html-delta').length,20)
    assert.ok(responses.every(response=>!Object.hasOwn(response.result,'html')))
    assert.ok(responses.reduce((sum,response)=>sum+response.delta.insert.length,0)<first.result.html.length)
  }finally{client.dispose()}
  assert.ok(workers.every(worker=>worker.terminated&&worker.listeners.size===0))
})
