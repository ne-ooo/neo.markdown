import {
  createParser,
  escapeHtml,
  type Parser,
  type ParserOptions,
} from '@lpm.dev/neo.markdown'
import { createParser as createSelectiveParser } from '@lpm.dev/neo.markdown/core'
import { createParser as createSanitizedParser } from '@lpm.dev/neo.markdown/sanitized'
import { heading, paragraph } from '@lpm.dev/neo.markdown/blocks'
import { createParser as createGfmParser } from '@lpm.dev/neo.markdown/gfm'
import {
  copyCodePlugin,
  getCopyCodeStyles,
  initializeCopyCode,
} from '@lpm.dev/neo.markdown/plugins/copy-code'
import { initializeEmbeds } from '@lpm.dev/neo.markdown/plugins/embeds'

const options: ParserOptions = { gfm: true }
const parser: Parser = createParser({
  ...options,
  plugins: [copyCodePlugin({ injectStyles: false })],
})
const selective: Parser = createSelectiveParser({ blocks: [heading, paragraph] })
const sanitized: Parser = createSanitizedParser({ allowHtml: true, sanitize: true })
const gfm: Parser = createGfmParser()
const html: string = parser.parse('# Package types')
const escaped: string = escapeHtml('<unsafe>')
const selectiveHtml: string = selective.parse('# Selective types')
const sanitizedHtml: string = sanitized.parse('<p>Package sanitizer</p>')
const gfmHtml: string = gfm.parse('~~Package types~~')
const stylesheet: string = getCopyCodeStyles()
const cleanup: () => void = initializeCopyCode()
const cleanupEmbeds: () => void = initializeEmbeds()

void [
  html,
  escaped,
  selectiveHtml,
  sanitizedHtml,
  gfmHtml,
  stylesheet,
  cleanup,
  cleanupEmbeds,
]
