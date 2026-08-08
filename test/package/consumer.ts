import {
  createParser,
  type Parser,
  type ParserOptions,
} from '@lpm.dev/neo.markdown'
import { createParser as createSelectiveParser } from '@lpm.dev/neo.markdown/core'
import { heading, paragraph } from '@lpm.dev/neo.markdown/blocks'
import {
  copyCodePlugin,
  getCopyCodeStyles,
  initializeCopyCode,
} from '@lpm.dev/neo.markdown/plugins/copy-code'

const options: ParserOptions = { gfm: true }
const parser: Parser = createParser({
  ...options,
  plugins: [copyCodePlugin({ injectStyles: false })],
})
const selective: Parser = createSelectiveParser({ blocks: [heading, paragraph] })
const html: string = parser.parse('# Package types')
const selectiveHtml: string = selective.parse('# Selective types')
const stylesheet: string = getCopyCodeStyles()
const cleanup: () => void = initializeCopyCode()

void [html, selectiveHtml, stylesheet, cleanup]
