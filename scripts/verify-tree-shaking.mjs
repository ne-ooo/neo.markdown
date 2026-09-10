import assert from 'node:assert/strict'
import { gzipSync } from 'node:zlib'
import { build } from 'esbuild'

const root = new URL('..', import.meta.url).pathname

async function bundle(contents) {
  const result = await build({
    stdin: {
      contents,
      resolveDir: root,
      sourcefile: 'tree-shaking-entry.js',
    },
    bundle: true,
    external: ['react', 'react-dom'],
    format: 'esm',
    minify: true,
    platform: 'browser',
    treeShaking: true,
    write: false,
  })
  const bytes = result.outputFiles[0].contents
  return { bytes: bytes.length, gzip: gzipSync(bytes).length }
}

const full = await bundle(`
  import { parse } from '@lpm.dev/neo.markdown'
  console.log(parse('# full'))
`)

const selective = await bundle(`
  import { createParser } from '@lpm.dev/neo.markdown/core'
  import { heading, paragraph } from '@lpm.dev/neo.markdown/blocks'
  const parser = createParser({ blocks: [heading, paragraph] })
  console.log(parser.parse('# selective'))
`)

const sanitized = await bundle(`
  import { parse } from '@lpm.dev/neo.markdown/sanitized'
  console.log(parse('<p>safe</p>', { allowHtml: true, sanitize: true }))
`)

const commonmark = await bundle(`
  import { parse } from '@lpm.dev/neo.markdown/commonmark'
  console.log(parse('# commonmark'))
`)

const gfm = await bundle(`
  import { parse } from '@lpm.dev/neo.markdown/gfm'
  console.log(parse('| a |\\n| - |\\n| b |'))
`)

assert.ok(
  full.gzip - selective.gzip >= 3_400,
  `selective imports must save at least 3,400 gzip bytes: full=${full.gzip}, selective=${selective.gzip}`
)

assert.ok(
  sanitized.gzip > full.gzip,
  `sanitized bundle must include its structural sanitizer: sanitized=${sanitized.gzip}, full=${full.gzip}`
)

assert.ok(
  commonmark.gzip < gfm.gzip,
  `CommonMark preset must exclude optional GFM cost: commonmark=${commonmark.gzip}, gfm=${gfm.gzip}`
)

// The pre-authoring baseline saves 3,432 gzip bytes. Preserve that saving
// within compression noise. A percentage penalizes shared API additions even
// when the amount of excluded code stays unchanged. Also check actual module
// boundaries so optional features cannot hide behind compression ratios.
async function presetInputs(preset) {
  const result = await build({
    stdin: {
      contents: `import { parse } from './src/presets/${preset}.ts'; console.log(parse('x'))`,
      resolveDir: root,
    },
    bundle: true,
    format: 'esm',
    minify: true,
    platform: 'browser',
    write: false,
    metafile: true,
  })
  return Object.values(result.metafile.outputs)[0].inputs
}
const [commonmarkInputs, gfmInputs] = await Promise.all([
  presetInputs('commonmark'), presetInputs('gfm'),
])
for (const module of ['src/inline/gfm-support.ts', 'src/blocks/rules/table.ts']) {
  assert.ok(!(commonmarkInputs[module]?.bytesInOutput > 0), `CommonMark includes ${module}`)
  assert.ok(gfmInputs[module]?.bytesInOutput > 0, `GFM omitted ${module}`)
}

const selectiveSource = await build({
  stdin: {
    contents: `import { createParser } from './src/core/index.ts'; import { heading, paragraph } from './src/blocks/index.ts'; console.log(createParser({blocks:[heading,paragraph]}).parse('x'))`,
    resolveDir: root,
  },
  bundle: true, format: 'esm', minify: true, platform: 'browser', write: false, metafile: true,
})
const selectiveInputs = Object.values(selectiveSource.metafile.outputs)[0].inputs
for (const module of ['src/core/code-block.ts', 'src/blocks/rules/code.ts', 'src/blocks/rules/table.ts', 'src/plugins/highlight.ts', 'src/plugins/highlight-renderer.ts', 'src/plugins/code-presentation.ts', 'src/plugins/code-word-ranges.ts']) {
  assert.ok(!(selectiveInputs[module]?.bytesInOutput > 0), `Selective parser includes ${module}`)
}

console.log(`Default parser:   ${full.bytes} bytes (${full.gzip} gzip)`)
console.log(`Heading + text:   ${selective.bytes} bytes (${selective.gzip} gzip)`)
console.log(`With sanitizer:   ${sanitized.bytes} bytes (${sanitized.gzip} gzip)`)
console.log(`CommonMark preset: ${commonmark.bytes} bytes (${commonmark.gzip} gzip)`)
console.log(`GFM preset:        ${gfm.bytes} bytes (${gfm.gzip} gzip)`)
console.log(`Selective saving: ${Math.round((1 - selective.gzip / full.gzip) * 100)}% gzip`)

const workerClient = await bundle(`
  import { createMarkdownWorkerClient } from '@lpm.dev/neo.markdown/experimental/worker-client'
  console.log(createMarkdownWorkerClient)
`)
const workerClientSource = await build({
  stdin: { contents: `import { createMarkdownWorkerClient } from './src/experimental/worker-client.ts'; console.log(createMarkdownWorkerClient)`, resolveDir: root },
  bundle: true, format: 'esm', minify: true, platform: 'browser', write: false, metafile: true,
})
for (const [path, input] of Object.entries(Object.values(workerClientSource.metafile.outputs)[0].inputs)) {
  assert.ok(input.bytesInOutput === 0 || path === '<stdin>' || /src\/experimental\/(worker-client\.ts|worker\/protocol\.ts)$/.test(path), `Worker client includes runtime module ${path}`)
}
console.log(`Worker client:     ${workerClient.bytes} bytes (${workerClient.gzip} gzip); no parser or sanitizer runtime`)

const application = await bundle(`
  import { createMarkdownApplication } from '@lpm.dev/neo.markdown/application'
  console.log(createMarkdownApplication)
`)
const applicationBuild = await build({
  stdin: { contents: `import { createMarkdownApplication } from '@lpm.dev/neo.markdown/application'; console.log(createMarkdownApplication)`, resolveDir: root },
  bundle: true, format: 'esm', minify: true, platform: 'browser', write: false, metafile: true,
})
for (const [path, input] of Object.entries(Object.values(applicationBuild.metafile.outputs)[0].inputs)) {
  assert.ok(input.bytesInOutput === 0 || path === '<stdin>' || /(?:dist\/(?:application\/index|experimental\/worker-client)\.js|src\/(?:application\/index|experimental\/worker-client|experimental\/worker\/protocol)\.ts)$/.test(path), `Application adapter includes optional runtime ${path}`)
}
console.log(`Application owner: ${application.bytes} bytes (${application.gzip} gzip); worker client included, parser/sanitizer/React excluded`)
