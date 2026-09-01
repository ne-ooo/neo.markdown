import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const EXECUTION_LIMIT_MS = 2_000
const fixturePath = fileURLToPath(
  new URL('./fixtures/parse-adversarial.ts', import.meta.url)
)
const requireFromVitest = createRequire(createRequire(import.meta.url).resolve('vitest'))
const viteNodePath = requireFromVitest.resolve('vite-node/vite-node.mjs')

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
] as const

describe('adversarial input scaling', () => {
  it.each(adversarialInputs)(
    'handles increasing %s inputs within a hard execution limit',
    { timeout: EXECUTION_LIMIT_MS + 1_000 },
    (scenario) => {
      const output = execFileSync(
        process.execPath,
        [viteNodePath, fixturePath, scenario],
        {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: EXECUTION_LIMIT_MS,
        }
      )

      expect(output.trim()).toBe('ok')
    }
  )
})
