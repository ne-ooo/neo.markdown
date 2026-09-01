import { createParser } from '../../../src/index.js'
import { createParser as createSanitizedParser } from '../../../src/sanitized.js'
import { InlineTokenizer } from '../../../src/core/inline-tokenizer.js'
import { copyCodePlugin } from '../../../src/plugins/copy-code.js'
import { tocPlugin } from '../../../src/plugins/toc.js'
import { embedPlugin } from '../../../src/plugins/embeds.js'

const INPUT_SIZES = [2_000, 8_000, 20_000] as const
const defaultParser = createParser({ gfm: true, maxNestingDepth: 32 })
const ugcParser = createParser({ ugc: true, gfm: true, maxNestingDepth: 32 })
const htmlParser = createParser({ allowHtml: true })
const tocParser = createParser({ allowHtml: true, plugins: [tocPlugin()] })
const copyParser = createParser({ allowHtml: true, plugins: [copyCodePlugin()] })
const breaksTokenizer = new InlineTokenizer([], { breaks: true })
const sanitizedEmbedParser = createSanitizedParser({
  allowHtml: true,
  sanitize: true,
  plugins: [embedPlugin({ youtube: true })],
})

function nestedEmphasis(depth: number): string {
  const openings: string[] = []
  const closings: string[] = []
  for (let index = 0; index < depth; index++) {
    const strong = index % 2 === 0
    openings.push(strong ? '**a ' : '*a ')
    closings.push(strong ? '**' : '*')
  }
  return `${openings.reverse().join('')}x${closings.join('')}`
}

const scenarios: Record<string, (size: number) => unknown> = {
  emphasis: (size) => defaultParser.parse('*_~'.repeat(size)),
  unmatchedEmphasis: (size) => defaultParser.parse('**a '.repeat(size)),
  unmatchedDelete: (size) => defaultParser.parse('~~a '.repeat(size)),
  nestedEmphasis: (size) => defaultParser.parse(nestedEmphasis(size)),
  nestedMax: (size) => ugcParser.parse(nestedEmphasis(size * 10 - 1)),
  inlineCode: (size) => defaultParser.parse(`x${'`'.repeat(size * 4)}a`),
  links: (size) => defaultParser.parse('[x]('.repeat(size)),
  html: (size) => defaultParser.parse('<a '.repeat(size)),
  htmlEnabled: (size) => htmlParser.parse('<a '.repeat(size * 4)),
  tocHtml: (size) => tocParser.parse(`# ${'<!--'.repeat(size * 2)}`),
  copyHtml: (size) => copyParser.parse('<pre '.repeat(size * 2)),
  table: (size) => defaultParser.parse(`|${' cell |'.repeat(size)}`),
  breaks: (size) => breaksTokenizer.tokenize('\n '.repeat(size * 4)),
  embedRestore: (size) => sanitizedEmbedParser.parse('::youtube[x]\n'.repeat(size)),
} as const

const scenario = process.argv[2] ?? ''
const run = scenarios[scenario]
if (!run) throw new TypeError(`Unknown adversarial scenario: ${scenario}`)

for (const size of INPUT_SIZES) {
  const output = run(size)
  if (output === undefined) throw new TypeError('Scenario returned no result')
}

process.stdout.write('ok\n')
