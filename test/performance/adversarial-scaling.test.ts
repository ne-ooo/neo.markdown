import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildSync } from 'esbuild'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const EXECUTION_LIMIT_MS = 2_000
const fixturePath = fileURLToPath(
  new URL('./fixtures/parse-adversarial.ts', import.meta.url)
)
let fixtureDirectory: string
let bundledFixture: string

beforeAll(() => {
  fixtureDirectory = mkdtempSync(join(tmpdir(), 'neo-adversarial-'))
  bundledFixture = join(fixtureDirectory, 'parse.cjs')
  buildSync({
    entryPoints: [fixturePath],
    outfile: bundledFixture,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
  })
})

afterAll(() => {
  if (fixtureDirectory) rmSync(fixtureDirectory, { recursive: true, force: true })
})

const adversarialInputs = [
  'emphasis',
  'unmatchedEmphasis',
  'unmatchedDelete',
  'nestedEmphasis',
  'nestedMax',
  'inlineCode',
  'links',
  'html',
  'htmlEnabled',
  'tocHtml',
  'copyHtml',
  'table',
  'breaks',
  'embedRestore',
  'balancedEmphasis',
  'referenceLabels',
  'nestedContainers',
  'entities',
  'gfmEmails',
  'gfmEmailMisses',
  'gfmTildeRuns',
  'gfmTableRows',
  'gfmTagFilter',
  'headingTrailingSpace',
  'headingOnlySpace',
  'autolinkTrailingPunctuation',
] as const

describe('adversarial input memory', () => {
  // Inline pieces were counted only once emphasis resolved: UGC mode built a
  // million of them, about 300 MB, before refusing 1,000,000 characters of
  // emphasis. Counted as they are built, it refuses them within 64 MB.
  it('refuses the largest UGC input of emphasis within a small heap', () => {
    const output = execFileSync(
      process.execPath,
      ['--max-old-space-size=64', bundledFixture, 'ugcEmphasis'],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: EXECUTION_LIMIT_MS,
        killSignal: 'SIGKILL',
      }
    )

    expect(output.trim()).toBe('ok')
  }, EXECUTION_LIMIT_MS + 1_000)
})

describe('adversarial input scaling', () => {
  it.each(adversarialInputs)(
    'handles increasing %s inputs within a hard execution limit',
    { timeout: EXECUTION_LIMIT_MS + 1_000 },
    (scenario) => {
      const output = execFileSync(
        process.execPath,
        [bundledFixture, scenario],
        {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: EXECUTION_LIMIT_MS,
          killSignal: 'SIGKILL',
        }
      )

      expect(output.trim()).toBe('ok')
    }
  )
})
