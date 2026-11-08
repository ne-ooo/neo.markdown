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
  'lineBreakRuns',
  'escapedLines',
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
  // Inline pieces were counted only once emphasis resolved, and email links
  // were built while a paragraph was scanned, before any was counted: UGC
  // mode built a million pieces, or 333,332 link tokens, before refusing the
  // largest input. Counted as they are built, it refuses them within 48 MB.
  // A custom rule's token in alt text was built into a string for every
  // token in it, and every token rules returned was kept with its measure.
  it.each(['customDeepAlt', 'customFreshImages'])(
    'parses %s within a small heap',
    { timeout: EXECUTION_LIMIT_MS + 1_000 },
    (scenario) => {
      const output = execFileSync(
        process.execPath,
        ['--max-old-space-size=48', bundledFixture, scenario],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: EXECUTION_LIMIT_MS, killSignal: 'SIGKILL' }
      )

      expect(output.trim()).toBe('ok')
    }
  )

  it.each(['ugcEmphasis', 'ugcEmails'])(
    'refuses the largest UGC input of %s within a small heap',
    { timeout: EXECUTION_LIMIT_MS + 1_000 },
    (scenario) => {
      const output = execFileSync(
        process.execPath,
        ['--max-old-space-size=48', bundledFixture, scenario],
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
