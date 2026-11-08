import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const highlightRoot = resolve(process.env.NEO_HIGHLIGHT_DIR ?? join(root, '../neo.highlight'))
const supportedHighlight = JSON.parse(await readFile(join(root, 'test/integration/highlight-version.json'), 'utf8'))
const highlightManifest = JSON.parse(await readFile(join(highlightRoot, 'package.json'), 'utf8'))
assert.equal(highlightManifest.name, '@lpm.dev/neo.highlight', 'Integration requires the neo.highlight package')
assert.equal(highlightManifest.version, supportedHighlight.version, `Integration requires neo.highlight ${supportedHighlight.version}`)
const consumer = await mkdtemp(join(tmpdir(), 'neo-markdown-highlight-'))

async function linkDependency(name, from) {
  const target = join(consumer, 'node_modules', name)
  await mkdir(dirname(target), { recursive: true })
  await symlink(await realpath(join(from, 'node_modules', name)), target, process.platform === 'win32' ? 'junction' : 'dir')
}

function run(command, args, env = {}) {
  const result = spawnSync(command, args, {
    cwd: consumer,
    encoding: 'utf8',
    timeout: 60_000,
    env: { ...process.env, ...env },
  })
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  assert.equal(result.status, 0, result.error?.message ?? `${command} failed`)
}

try {
  // Copy publishable files so tests cannot accidentally import package source.
  for (const packageRoot of [root, highlightRoot]) {
    const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
    const target = join(consumer, 'node_modules', manifest.name)
    await mkdir(target, { recursive: true })
    await cp(join(packageRoot, 'package.json'), join(target, 'package.json'))
    await cp(join(packageRoot, 'dist'), join(target, 'dist'), { recursive: true })
  }
  await linkDependency('sanitize-html', root)
  await linkDependency('jsdom', highlightRoot)
  await writeFile(join(consumer, 'package.json'), '{"private":true,"type":"module"}\n')
  await writeFile(join(consumer, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext',
      lib: ['ES2022', 'DOM'], types: [], strict: true, noEmit: true, skipLibCheck: true,
    },
    include: ['consumer.ts', 'consumer.cts'],
  }))
  await cp(join(root, 'test/integration/highlight-runtime.mjs'), join(consumer, 'highlight.test.mjs'))
  await cp(join(root, 'test/integration/dom-runtime.mjs'), join(consumer, 'dom.test.mjs'))
  await cp(join(root, 'test/integration/worker-runtime.mjs'), join(consumer, 'worker.test.mjs'))
  await cp(join(root, 'test/integration/application-runtime.mjs'), join(consumer, 'application.test.mjs'))
  await cp(join(root, 'test/integration/worker-fixture.mjs'), join(consumer, 'worker-fixture.mjs'))
  const { tests } = createRequire(import.meta.url)('commonmark-spec')
  const gfm = JSON.parse(await readFile(join(root, 'test/fixtures/gfm-official.json'), 'utf8'))
  await writeFile(join(consumer, 'dom-fixtures.json'), JSON.stringify([...tests, ...gfm.examples]))
  for (const extension of ['ts', 'cts']) {
    await cp(join(root, 'test/integration/highlight-consumer.ts'), join(consumer, `consumer.${extension}`))
  }
  run(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', join(consumer, 'tsconfig.json')])
  for (const mode of ['esm', 'cjs']) {
    run(process.execPath, ['--test', 'highlight.test.mjs', 'dom.test.mjs', 'worker.test.mjs', 'application.test.mjs'], { NEO_INTEGRATION_FORMAT: mode })
  }
  console.log('Built Markdown + highlight integration passed in ESM, CommonJS, and TypeScript; Node ' + process.version)
} finally {
  await rm(consumer, { recursive: true, force: true })
}
