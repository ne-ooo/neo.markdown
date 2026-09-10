import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { performance } from 'node:perf_hooks'
import { cpus } from 'node:os'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const fixtures = JSON.parse(readFileSync(new URL('./efficiency-fixtures.json', import.meta.url)))
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
const isHighlight = Object.hasOwn(fixtures, 'JS_SMALL')
const modes = isHighlight ? ['inline', 'class'] : ['prose', 'entities']
const childMode = process.argv[2]

if (childMode) {
  global.gc()
  const before = process.memoryUsage()
  const start = performance.now()
  const core = await import('../dist/index.js')
  const grammar = isHighlight ? await import('../dist/grammars/javascript.js') : null
  const theme = isHighlight ? await import('../dist/themes/github-dark.js') : null
  const imported = performance.now()
  const parser = isHighlight ? null : core.createParser({ gfm: true })
  const css = isHighlight && childMode === 'class' ? core.getThemeStylesheet(theme.githubDark) : ''
  const run = isHighlight
    ? code => core.renderToHTML(core.tokenize(code, grammar.javascript), { theme: theme.githubDark, language: 'javascript', styleMode: childMode })
    : code => parser.parse(code)
  const initialized = performance.now()
  const firstFixture = isHighlight ? 'JS_SMALL' : childMode === 'entities' ? 'MD_ENTITIES' : 'MD_SMALL'
  run(fixtures[firstFixture])
  const first = performance.now()
  global.gc()
  const result = {
    importMs: imported - start, initializeMs: initialized - imported, firstCallMs: first - initialized,
    retainedHeapAfterFirstCall: process.memoryUsage().heapUsed - before.heapUsed,
    stylesheetBytes: Buffer.byteLength(css), stylesheetGzip: css ? gzipSync(css).length : 0,
    fixtures: {},
  }
  let sink = 0
  for (const [name, source] of Object.entries(fixtures)) {
    const warmStart = performance.now()
    for (let i = 0; i < 100 || performance.now() - warmStart < 200; i++) run(source)
    const count = name.endsWith('SMALL') ? 5000 : name.endsWith('LARGE') ? 50 : 200
    const samples = []
    for (let batch = 0; batch < 7; batch++) {
      const t = performance.now()
      for (let i = 0; i < count; i++) sink += run(source).length
      samples.push((performance.now() - t) / count)
    }
    const html = run(source)
    result.fixtures[name] = {
      sourceBytes: Buffer.byteLength(source), medianMs: median(samples), samplesMs: samples,
      htmlBytes: Buffer.byteLength(html), htmlGzip: gzipSync(html).length,
      htmlAndCssGzip: gzipSync(css + html).length,
      tenRepeatedBlocksAndCssGzip: gzipSync(css + html.repeat(10)).length,
    }
  }
  global.gc()
  result.retainedHeapAfterWarmCalls = process.memoryUsage().heapUsed - before.heapUsed
  result.processPeakRssBytes = process.resourceUsage().maxRSS * 1024
  result.sink = sink
  console.log(JSON.stringify(result))
} else {
  const result = { node: process.version, platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model, modes: {} }
  for (const mode of modes) {
    // Fresh processes isolate initialization and avoid cross-mode caches.
    const samples = []
    for (let i = 0; i < 3; i++) {
      const child = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url), mode], { encoding: 'utf8', timeout: 60_000, killSignal: 'SIGKILL' })
      assert.equal(child.status, 0, child.error?.message ?? child.stderr)
      samples.push(JSON.parse(child.stdout))
    }
    result.modes[mode] = samples
  }
  console.log(JSON.stringify(result, null, 2))
}
