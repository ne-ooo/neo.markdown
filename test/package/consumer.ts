import {
  createParser,
  escapeHtml,
  type Parser,
  type ParserOptions,
  parseDocument,
  type DocumentResult,
} from '@lpm.dev/neo.markdown'
import { createParser as createSelectiveParser } from '@lpm.dev/neo.markdown/core'
import { createParser as createSanitizedParser } from '@lpm.dev/neo.markdown/sanitized'
import { heading, paragraph } from '@lpm.dev/neo.markdown/blocks'
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
const html: string = parser.parse('# Package types')
const escaped: string = escapeHtml('<unsafe>')
const selectiveHtml: string = selective.parse('# Selective types')
const sanitizedHtml: string = sanitized.parse('<p>Package sanitizer</p>')
const stylesheet: string = getCopyCodeStyles()
const cleanup: () => void = initializeCopyCode()
const cleanupEmbeds: () => void = initializeEmbeds()

void [html, escaped, selectiveHtml, sanitizedHtml, stylesheet, cleanup, cleanupEmbeds]

import { codePresentationPlugin, getCodePresentationStyles } from '@lpm.dev/neo.markdown/plugins/code-presentation'
createParser({ plugins: [codePresentationPlugin()] })
getCodePresentationStyles()

const result: DocumentResult = parseDocument('# Structured', options, { maxStylesheets: 8 })
const renderedResult: DocumentResult = parser.renderDocument(parser.tokenize('# Tokens'))
const selectedResult: DocumentResult = selective.parseDocument('# Selective')
const safeResult: DocumentResult = sanitized.parseDocument('<p>Safe</p>')
createParser({ plugins: [builder => builder.addHtmlTransform(html => {
  builder.document?.addStylesheet({ id: 'custom', css: '.custom{}' })
  builder.document?.reportDiagnostic({ source: 'custom', code: 'example', severity: 'warning', message: 'Example' })
  return html
})] })
void [result, renderedResult, selectedResult, safeResult]

import { createIncrementalMarkdown, defineIncrementalPlugin, type IncrementalReusePolicy } from '@lpm.dev/neo.markdown/experimental'
const incremental = createIncrementalMarkdown({ parser: { gfm: true }, maxEntries: 20,
  maxBlockCheckpoints: 100, maxCachedBlockTokens: 1000, maxCachedBlockCodeUnits: 10_000, maxCachedReferenceDependencies: 100 })
const incrementalResult: DocumentResult = incremental.append('# Typed session\n')
const resumedAt: number = incremental.metrics.lastBlockRestart
const dependencyCount: number = incremental.metrics.cachedReferenceDependencies
void [incrementalResult, resumedAt, dependencyCount]
incremental.dispose()

import { IncrementalMarkdownLimitError, type IncrementalMarkdownLimit } from '@lpm.dev/neo.markdown/experimental'
const limitError: RangeError = new IncrementalMarkdownLimitError('maxUpdates')
const limit: IncrementalMarkdownLimit = (limitError as IncrementalMarkdownLimitError).limit
void limit

const declaredPlugin = defineIncrementalPlugin(codePresentationPlugin(), { protocol: 1, id: 'presentation', profile: 'render' })
const renderingSession = createIncrementalMarkdown({ pluginReuse: 'declared', parser: { plugins: [declaredPlugin] } })
const policy: IncrementalReusePolicy = renderingSession.reuse
const clones: number = renderingSession.metrics.clonedTokenNodes
void [policy, clones]
renderingSession.dispose()

const inlinePlugin = defineIncrementalPlugin(builder => {
  builder.addInlineRule({ name: 'mention', triggerChars: [64], tokenize: source => source.startsWith('@neo')
    ? { raw: '@neo', token: { type: 'code', raw: '@neo', text: 'Neo' } } : null })
}, { protocol: 1, id: 'mention', profile: 'inline', effects: 'none', dependencies: { kind: 'revision', read: () => 'v1' } })
const inlineSession = createIncrementalMarkdown({ pluginReuse: 'declared', parser: { plugins: [inlinePlugin] } })
const invalidations: number = inlineSession.metrics.pluginInvalidations
void [inlineSession.update('@neo'), invalidations]
inlineSession.dispose()


import { useMarkdownDocument, type MarkdownDocumentPreview } from '@lpm.dev/neo.markdown/application/react'
import { createMarkdownApplication, type MarkdownApplicationOptions } from '@lpm.dev/neo.markdown/application'
import { createMarkdownSynchronousSession } from '@lpm.dev/neo.markdown/application/sync'
const applicationOptions: MarkdownApplicationOptions = { createFallback: () => createMarkdownSynchronousSession() }
const reactHook: (source: string, options: MarkdownApplicationOptions) => MarkdownDocumentPreview = useMarkdownDocument
const applicationOwner = createMarkdownApplication(applicationOptions)
void reactHook; applicationOwner.reset(); applicationOwner.dispose()
