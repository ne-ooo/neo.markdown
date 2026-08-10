import { createParser } from '../../../src/index.js'

const INPUT_SIZES = [2_000, 8_000, 20_000] as const
const scenarios = {
  emphasis: (size: number) => '*_~'.repeat(size),
  links: (size: number) => '[x]('.repeat(size),
  html: (size: number) => '<a '.repeat(size),
  table: (size: number) => `|${' cell |'.repeat(size)}`,
} as const

const scenario = process.argv[2] as keyof typeof scenarios
const makeInput = scenarios[scenario]
if (!makeInput) throw new TypeError(`Unknown adversarial scenario: ${scenario}`)

const parser = createParser({ gfm: true, maxNestingDepth: 32 })
for (const size of INPUT_SIZES) {
  const html = parser.parse(makeInput(size))
  if (typeof html !== 'string') throw new TypeError('Parser returned a non-string value')
}

process.stdout.write('ok\n')
