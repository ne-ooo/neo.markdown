import { deepStrictEqual } from 'node:assert'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { cpus, release, tmpdir, totalmem } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildSync } from 'esbuild'

// Compare the current source with a Git revision using identical bundles.
// Usage: node test/benchmarks/compare-inline-indexes.mjs <baseline-ref> [results.json]
const [baselineRef, output] = process.argv.slice(2)
if (!baselineRef) throw new Error('Provide a baseline Git revision')
const root = fileURLToPath(new URL('../../', import.meta.url))
const baseline = execFileSync('git', ['rev-parse', '--verify', `${baselineRef}^{commit}`], { cwd: root, encoding: 'utf8' }).trim()
const directory = mkdtempSync(join(tmpdir(), 'neo-markdown-inline-'))
const require = createRequire(import.meta.url)
let result

function sample(fn, duration) {
  const start = performance.now()
  let count = 0
  let elapsed
  do {
    for (let index = 0; index < 32; index++) result = fn()
    count += 32
    elapsed = performance.now() - start
  } while (elapsed < duration)
  return elapsed * 1000 / count
}

try {
  const baselineSource = join(directory, 'source')
  mkdirSync(baselineSource)
  const archive = execFileSync('git', ['archive', baseline, 'src'], { cwd: root, maxBuffer: 32 * 1024 * 1024 })
  execFileSync('tar', ['-xf', '-', '-C', baselineSource], { input: archive })
  const modules = [baselineSource, root].map((source, index) => {
    const outdir = join(directory, String(index))
    buildSync({
      entryPoints: ['src/index.ts', 'src/core/inline-tokenizer.ts'].map(entry => join(source, entry)),
      bundle: true, platform: 'node', format: 'cjs', outdir,
      outExtension: { '.js': '.cjs' }, logLevel: 'silent',
      tsconfig: join(root, 'tsconfig.json'), nodePaths: [join(root, 'node_modules')],
    })
    return { ...require(join(outdir, 'index.cjs')), ...require(join(outdir, 'core/inline-tokenizer.cjs')) }
  })

  const emphasized = 'This is **bold** and *italic* text with &amp; entities.'
  const prose = 'The parser reads each paragraph and returns HTML for the application. '.repeat(20)
  const sparse = prose + '**This sentence matters.** ' + prose
  const mixed = '# Heading\n\n' + emphasized + '\n\n- Item with `code`\n- Item with [link](https://example.com)\n\n> Quoted **text**\n'
  const cases = [
    ['plain control', 'An ordinary sentence with no inline syntax.'],
    ['emphasis', emphasized],
    ['sparse emphasis', sparse],
    ['unmatched emphasis', '*word '.repeat(100)],
    ['escapes', 'Escaped \\*stars\\* and \\!punctuation.'],
    ['code spans', 'Text with `inline code` and ``code ` with ticks``.'],
    ['links', '[one](https://example.com "title") and [two](path/to/file).'],
    ['GFM email', 'Contact user@example.com for **help**.'],
    ['GFM deletion', 'This is ~~old~~ and **new**.'],
  ].map(([name, source]) => ({ name: `inline: ${name}`, source, inline: true }))
  cases.push(...[
    ['short emphasis', emphasized],
    ['sparse emphasis', sparse],
    ['100 emphasized paragraphs', Array(100).fill(emphasized).join('\n\n')],
    ['mixed document', mixed.repeat(100)],
  ].map(([name, source]) => ({ name: `parse: ${name}`, source, inline: false })))

  const results = []
  for (const fixture of cases) {
    const fns = modules.map(module => {
      const parser = fixture.inline
        ? new module.InlineTokenizer([], { gfm: true })
        : module.createParser({ gfm: true })
      return () => fixture.inline ? parser.tokenize(fixture.source) : parser.parse(fixture.source)
    })
    deepStrictEqual(fns[0](), fns[1](), fixture.name)
    for (let round = 0; round < 3; round++) for (const fn of fns) sample(fn, 100)
    const samples = [[], []]
    for (let round = 0; round < 7; round++) {
      for (const version of (round % 2 ? [1, 0] : [0, 1])) {
        samples[version].push(sample(fns[version], 150))
      }
    }
    const [before, after] = samples.map(values => [...values].sort((a, b) => a - b)[3])
    results.push({ name: fixture.name, bytes: Buffer.byteLength(fixture.source), before, after, speedup: before / after, samples })
    console.log(`${fixture.name}: ${before.toFixed(3)} -> ${after.toFixed(3)} us (${(before / after).toFixed(2)}x)`)
  }
  const report = {
    baseline, date: new Date().toISOString(), node: process.version,
    platform: process.platform, arch: process.arch, osRelease: release(),
    cpu: cpus()[0]?.model, memoryBytes: totalmem(),
    method: 'Microseconds per operation; median of seven alternating samples of at least 150 ms, after three 100 ms warmups per version. Reused GFM parsers; exact output equality checked before timing.',
    results,
  }
  if (output) writeFileSync(resolve(output), JSON.stringify(report, null, 2) + '\n')
  if (!result) throw new Error('No benchmark output')
} finally {
  rmSync(directory, { recursive: true, force: true })
}
