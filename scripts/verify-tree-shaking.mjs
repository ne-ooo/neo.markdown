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

assert.ok(
  selective.gzip < full.gzip * 0.85,
  `selective bundle must be at least 15% smaller: full=${full.gzip}, selective=${selective.gzip}`
)

assert.ok(
  sanitized.gzip > full.gzip,
  `sanitized bundle must include its structural sanitizer: sanitized=${sanitized.gzip}, full=${full.gzip}`
)

console.log(`Default parser:   ${full.bytes} bytes (${full.gzip} gzip)`)
console.log(`Heading + text:   ${selective.bytes} bytes (${selective.gzip} gzip)`)
console.log(`With sanitizer:   ${sanitized.bytes} bytes (${sanitized.gzip} gzip)`)
console.log(`Selective saving: ${Math.round((1 - selective.gzip / full.gzip) * 100)}% gzip`)
