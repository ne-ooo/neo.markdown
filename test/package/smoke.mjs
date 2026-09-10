import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { access } from 'node:fs/promises'

const require = createRequire(import.meta.url)
const esm = await import('../../dist/index.js')
const esmCore = await import('../../dist/core/index.js')
const esmBlocks = await import('../../dist/blocks/index.js')
const esmSanitized = await import('../../dist/sanitized.js')
const cjs = require('../../dist/index.cjs')
const cjsCore = require('../../dist/core/index.cjs')
const cjsBlocks = require('../../dist/blocks/index.cjs')
const cjsSanitized = require('../../dist/sanitized.cjs')
// The optional DOM entry is safe to import on a server without a document global.
for (const mod of [await import('../../dist/experimental/dom.js'), require('../../dist/experimental/dom.cjs')]) {
  assert.equal(typeof mod.createMarkdownView, 'function')
}

for (const mod of [await import('../../dist/experimental/index.js'), require('../../dist/experimental/index.cjs')]) {
  assert.throws(() => mod.createIncrementalMarkdown({ maxUpdates: 0 }).update(''), error =>
    error instanceof RangeError && error instanceof mod.IncrementalMarkdownLimitError && error.limit === 'maxUpdates')
  const session = mod.createIncrementalMarkdown()
  assert.equal(session.append('# Experimental').html, '<h1>Experimental</h1>\n')
  const source = '# Kept\n\nStable **text**.\n\n[link][target]\n\n[target]: /first\n'
  session.update(source)
  const changed = source.replace('/first', '/second')
  assert.deepEqual(session.update(changed), esm.createParser().parseDocument(changed))
  assert.ok(session.metrics.reusedBlocks > 0)
  assert.ok(session.metrics.lastBlockRestart > 0)
  assert.ok(session.metrics.invalidatedInlineEntries > 0)
  session.dispose()
}

assert.equal(esm.parse('# ESM'), '<h1>ESM</h1>\n')
assert.equal(cjs.parse('# CJS'), '<h1>CJS</h1>\n')
assert.equal(
  esmSanitized.parse('<script>bad()</script><p>ESM</p>', { allowHtml: true, sanitize: true }),
  '<p>ESM</p>\n'
)
assert.equal(
  cjsSanitized.parse('<script>bad()</script><p>CJS</p>', { allowHtml: true, sanitize: true }),
  '<p>CJS</p>\n'
)

const esmSelective = esmCore.createParser({
  blocks: [esmBlocks.heading, esmBlocks.paragraph],
})
const cjsSelective = cjsCore.createParser({
  blocks: [cjsBlocks.heading, cjsBlocks.paragraph],
})

assert.equal(esmSelective.parse('# Selective ESM'), '<h1>Selective ESM</h1>\n')
assert.equal(cjsSelective.parse('# Selective CJS'), '<h1>Selective CJS</h1>\n')
assert.ok(!esmSelective.parse('```js\ncode\n```').includes('<pre>'))
assert.ok(!cjsSelective.parse('```js\ncode\n```').includes('<pre>'))

await Promise.all([
  access(new URL('../../dist/index.d.ts', import.meta.url)),
  access(new URL('../../dist/index.d.cts', import.meta.url)),
  access(new URL('../../dist/sanitized.d.ts', import.meta.url)),
  access(new URL('../../dist/sanitized.d.cts', import.meta.url)),
])

console.log('ESM, CJS, and declaration package smoke tests passed')

for (const mod of [await import('../../dist/plugins/code-presentation.js'), require('../../dist/plugins/code-presentation.cjs')]) {
  const parser = esm.createParser({ plugins: [mod.codePresentationPlugin({ injectStyles: false })] })
  assert.match(parser.parse('```text caption=Example diff\n- old\n+ new\n```'), /data-copy-code-exclude="true"/)
  assert.ok(mod.getCodePresentationStyles().includes('.neo-code-source'))
}


const esmExperimental = await import('../../dist/experimental/index.js')
const cjsExperimental = require('../../dist/experimental/index.cjs')
for (const api of [esmExperimental, cjsExperimental]) {
  for (const toc of [await import('../../dist/plugins/toc.js'), require('../../dist/plugins/toc.cjs')]) {
    const plugin = api.defineIncrementalPlugin(toc.tocPlugin(), { protocol: 1, id: 'toc', profile: 'render' })
    const session = api.createIncrementalMarkdown({ pluginReuse: 'declared', parser: { plugins: [plugin] } })
    const source = '# Same\n\n# Same\n'
    assert.deepEqual(session.update(source), esm.createParser({ plugins: [toc.tocPlugin()] }).parseDocument(source))
    session.update(source)
    assert.equal(session.reuse.mode, 'declared')
    assert.ok(session.metrics.reusedBlocks > 0)
    session.dispose()
  }
}
const foreign = esmExperimental.defineIncrementalPlugin(() => {}, { protocol: 1, id: 'foreign', profile: 'render' })
const mixed = cjsExperimental.createIncrementalMarkdown({ pluginReuse: 'declared', parser: { plugins: [foreign] } })
assert.equal(mixed.reuse.blockers[0].code, 'undeclared-plugin')
assert.equal(mixed.update('safe').html, '<p>safe</p>\n')
mixed.dispose()
console.log('Declared plugin consumers and mixed-format fallback passed')

for (const api of [esmExperimental, cjsExperimental]) {
  let revision = 'first', reads = 0, calls = 0
  const plugin = api.defineIncrementalPlugin(builder => builder.addInlineRule({ name: 'mention', triggerChars: [64], tokenize: source => {
    calls++
    return source.startsWith('@neo') ? { raw: '@neo', token: { type: 'code', raw: '@neo', text: revision } } : null
  } }), { protocol: 1, id: 'inline', profile: 'inline', effects: 'none', dependencies: { kind: 'revision', read: () => { reads++; return revision } } })
  const session = api.createIncrementalMarkdown({ pluginReuse: 'declared', parser: { plugins: [plugin] } })
  assert.match(session.update('@neo').html, /first/)
  assert.match(session.append('').html, /first/)
  assert.equal(calls, 1)
  revision = 'second'
  assert.match(session.update('@neo').html, /second/)
  assert.equal(calls, 2)
  assert.equal(reads, 3)
  assert.equal(session.metrics.pluginInvalidations, 1)
  session.dispose()
  const guarded = api.createIncrementalMarkdown({ pluginReuse: 'declared', parser: { plugins: [api.defineIncrementalPlugin(builder => {
    builder.addInlineRule({ name: 'guard', tokenize: () => { builder.renderInline([]); return null } })
  }, { protocol: 1, id: 'guard', profile: 'inline', effects: 'none', dependencies: { kind: 'static' } })] } })
  assert.throws(() => guarded.update('x'), /cannot use rendering or document services/)
}
console.log('Pure inline consumers, guards, and revision invalidation passed')

// Optional worker entries do not create globals or start workers during import.
for (const format of ['js', 'cjs']) {
  const handlerApi = format === 'js' ? await import('../../dist/experimental/worker.js') : require('../../dist/experimental/worker.cjs')
  const clientApi = format === 'js' ? await import('../../dist/experimental/worker-client.js') : require('../../dist/experimental/worker-client.cjs')
  const handler = handlerApi.createMarkdownWorkerHandler()
  let starts = 0
  const client = clientApi.createMarkdownWorkerClient({ createWorker: () => { starts++; throw new Error('must stay lazy') } })
  assert.equal(starts, 0); client.dispose(); handler.dispose()
  await assert.rejects(client.update('closed'), error => error instanceof clientApi.MarkdownWorkerError && error.code === 'DISPOSED')
}
