import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
assert.match(manifest.version, /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/, 'Package version must be a release version')

const args = process.argv.slice(2)
assert.ok(args.length === 0 || (args.length === 2 && args[0] === '--tag'), 'Usage: check-release-metadata.mjs [--tag vVERSION]')
if (args.length) assert.equal(args[1], `v${manifest.version}`, 'Release tag must match package version')

const changelog = await readFile(resolve(root, 'CHANGELOG.md'), 'utf8')
assert.ok(changelog.split('\n').some(line => line.startsWith(`## [${manifest.version}] - `)), 'Changelog must describe this package version')

const skills = (await readdir(resolve(root, '.lpm/skills'))).filter(name => name.endsWith('.md'))
assert.ok(skills.length, 'Package must contain LPM skills')
for (const name of skills) {
  const text = await readFile(resolve(root, '.lpm/skills', name), 'utf8')
  assert.ok(Buffer.byteLength(text, 'utf8') <= 15_000, `${name} exceeds the 15 KB skill limit`)
  const frontmatter = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1]
  assert.ok(frontmatter, `${name} must contain skill frontmatter`)
  const versions = [...frontmatter.matchAll(/^version: "([^"]+)"\r?$/gm)]
  assert.equal(versions.length, 1, `${name} must declare one version`)
  assert.equal(versions[0][1], manifest.version, `${name} version must match the package`)
}

const allowed = /^(?:dist|\.lpm\/skills|README\.md|CONTRIBUTING\.md|CHANGELOG\.md|LICENSE|THIRD_PARTY_NOTICES\.md|docs\/[a-z0-9-]+\.md)$/
assert.ok(Array.isArray(manifest.files) && manifest.files.length, 'Package must use an explicit file allowlist')
for (const entry of manifest.files) assert.match(entry, allowed, `Unexpected publish path: ${entry}`)
assert.ok(manifest.files.includes('.lpm/skills'), 'Publish only the skills subdirectory of .lpm')
assert.ok(!Object.keys(manifest.scripts).some(name => name.startsWith('prepublish') && manifest.scripts[name].includes('publish --yes')), 'Release hooks must not publish recursively')

console.log(`Release metadata passed: ${manifest.name}@${manifest.version}, ${skills.length} skills`)
