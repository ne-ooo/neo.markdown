import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { Worker } from 'node:worker_threads'
import { parserOptions } from './worker-fixture.mjs'
const require = createRequire(import.meta.url)
const load = path => process.env.NEO_INTEGRATION_FORMAT === 'cjs' ? require(path) : import(path)
const { createMarkdownApplication, MarkdownApplicationError } = await load('@lpm.dev/neo.markdown/application')
const { createMarkdownSynchronousSession } = await load('@lpm.dev/neo.markdown/application/sync')
const { createMarkdownView } = await load('@lpm.dev/neo.markdown/dom')
const { createParser } = await load('@lpm.dev/neo.markdown')
const { initializeCopyCode } = await load('@lpm.dev/neo.markdown/plugins/copy-code')
const { JSDOM } = require('jsdom')
function nativeWorker() {
  const worker = new Worker(new URL('./worker-fixture.mjs', import.meta.url)), listeners = new Map()
  return {
    postMessage: data => worker.postMessage(data), terminate: () => worker.terminate(),
    addEventListener(type, listener) { const wrapped = data => listener(type === 'message' ? { data } : data); listeners.set(listener, wrapped); worker.on(type, wrapped) },
    removeEventListener(type, listener) { worker.off(type, listeners.get(listener)); listeners.delete(listener) },
  }
}
test('stable and legacy imports share identical runtimes and plugin contracts', async () => {
  for (const [stable, legacy] of [['incremental','experimental'], ['dom','experimental/dom'], ['worker','experimental/worker'], ['worker-client','experimental/worker-client']]) {
    const a = await load('@lpm.dev/neo.markdown/'+stable), b = await load('@lpm.dev/neo.markdown/'+legacy)
    assert.deepEqual(Object.keys(a).sort(), Object.keys(b).sort())
    for (const key of Object.keys(a)) assert.equal(a[key], b[key], stable+':'+key)
  }
  const session = createMarkdownSynchronousSession({ maxWorkCodeUnits: 0 })
  assert.throws(() => session.update('text'), error => error instanceof MarkdownApplicationError && error.code === 'WORK_LIMIT')
  session.dispose()
})
for (const mode of ['worker','synchronous']) {
  test('framework-neutral application parity across specification fixtures: '+mode, async () => {
    const app = createMarkdownApplication(mode === 'worker' ? { createWorker: nativeWorker, timeoutMs: 10_000 } : { createFallback: () => createMarkdownSynchronousSession({ parser: parserOptions(), pluginReuse: 'declared' }) })
    const parser = createParser(parserOptions())
    try {
      for (const fixture of JSON.parse(await readFile(new URL('./dom-fixtures.json', import.meta.url),'utf8'))) {
        const outcome = await app.update(fixture.markdown)
        assert.equal(outcome.status,'ready'); assert.equal(app.isCurrent(outcome),true)
        assert.deepEqual(outcome.result,parser.parseDocument(fixture.markdown),String(fixture.example))
      }
      app.reset(); assert.equal((await app.update('# Reset')).status,'ready')
    } finally { app.dispose() }
  })
  test('vanilla DOM integration retains clean copying and rejects stale ownership: '+mode, async () => {
    const app = createMarkdownApplication(mode === 'worker' ? { createWorker: nativeWorker } : { createFallback: () => createMarkdownSynchronousSession({ parser: parserOptions(), pluginReuse:'declared' }) })
    const dom = new JSDOM('<div id="preview"></div>',{url:'https://example.test'}), document = dom.window.document, element = document.querySelector('#preview')
    const originals = new Map()
    for (const [key,value] of Object.entries({document,navigator:dom.window.navigator,window:dom.window,Element:dom.window.Element,HTMLElement:dom.window.HTMLElement,Node:dom.window.Node})) { originals.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,configurable:true}) }
    let copied
    Object.defineProperty(dom.window.navigator,'clipboard',{value:{writeText:async text=>{copied=text}},configurable:true})
    const view = createMarkdownView(element,{initialize: root=>{const copy=initializeCopyCode({root});return {dispose:copy,update:()=>copy.refresh()}}})
    const source='# Vanilla\n\n```js diff filename=api.js\n- const old = 1;\n+ const value = 2;\n```\n'
    try {
      const first=await app.update(source);assert.equal(first.status,'ready');view.update(first.result.html)
      const button=element.querySelector('[data-copy-code]');assert.ok(button);button.click();await Promise.resolve();assert.equal(copied,'const value = 2;\n')
      const second=await app.update(source.replace('value = 2','value = 3'));assert.equal(second.status,'ready');assert.equal(app.isCurrent(first),false)
      view.update(second.result.html);assert.equal(element.querySelector('[data-copy-code]'),button)
      button.click();await Promise.resolve();assert.equal(copied,'const value = 3;\n')
      app.reset();assert.equal(app.isCurrent(second),false)
    } finally {
      view.dispose();app.dispose();dom.window.close()
      for (const [key,descriptor] of originals) { if (descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key] }
    }
  })
}
