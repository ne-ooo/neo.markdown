import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { access } from 'node:fs/promises'

const require = createRequire(import.meta.url)
const esm = await import('../../dist/index.js')
const esmCore = await import('../../dist/core/index.js')
const esmBlocks = await import('../../dist/blocks/index.js')
const cjs = require('../../dist/index.cjs')
const cjsCore = require('../../dist/core/index.cjs')
const cjsBlocks = require('../../dist/blocks/index.cjs')

assert.equal(esm.parse('# ESM'), '<h1>ESM</h1>\n')
assert.equal(cjs.parse('# CJS'), '<h1>CJS</h1>\n')

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
])

console.log('ESM, CJS, and declaration package smoke tests passed')
