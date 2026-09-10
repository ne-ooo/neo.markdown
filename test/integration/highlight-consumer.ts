import { createParser, parseDocument, type DocumentResult } from '@lpm.dev/neo.markdown'
import {
  highlightPlugin,
  type HighlightOptions,
  type HighlightErrorContext,
} from '@lpm.dev/neo.markdown/plugins/highlight'
import { tokenize, renderToHTML, getThemeStylesheet, validateThemeContrast } from '@lpm.dev/neo.highlight'
import type { Grammar, Token, Theme } from '@lpm.dev/neo.highlight'
import { javascript } from '@lpm.dev/neo.highlight/grammars/javascript'
import { python } from '@lpm.dev/neo.highlight/grammars/python'
import { css } from '@lpm.dev/neo.highlight/grammars/css'
import { html } from '@lpm.dev/neo.highlight/grammars/html'
import { vue } from '@lpm.dev/neo.highlight/grammars/vue'
import { svelte } from '@lpm.dev/neo.highlight/grammars/svelte'
import { githubDark } from '@lpm.dev/neo.highlight/themes/github-dark'
import { createMarkdownView, type MarkdownViewOptions, type MarkdownViewUpdate, type MarkdownViewLifecycle } from '@lpm.dev/neo.markdown/experimental/dom'
import { initializeCopyCode, type CopyCodeController } from '@lpm.dev/neo.markdown/plugins/copy-code'

function attachPreview(root: HTMLElement, html: string): MarkdownViewUpdate {
  const options: MarkdownViewOptions = { maxCachedHtmlLength: 10_000, maxCodeBlockHtmlLength: 100_000, maxNodes: 1_000, maxRegions: 100, maxDepth: 30, patchChildren: true,
    initialize(region): MarkdownViewLifecycle {
      const copy: CopyCodeController = initializeCopyCode({ root: region })
      return { dispose: copy, update: copy.refresh }
    },
  }
  const view = createMarkdownView(root, options)
  const result: MarkdownViewUpdate = view.update(html)
  const retained: number = view.metrics.cachedHtmlCodeUnits
  const nodes: number = view.metrics.cachedNodes
  const patched: number | undefined = result.patchedRegions
  void nodes; void patched
  void retained
  view.dispose()
  return result
}
void attachPreview

const options = {
  grammars: [javascript, python, css, html, vue, svelte], tokenize, renderToHTML, getThemeStylesheet, validateThemeContrast,
  theme: githubDark, maxInputLength: 10_000, maxMatchCount: 10_000, maxTokenCount: 10_000,
  maxTokenDepth: 20, maxRenderedLength: 100_000, maxLines: 1_000,
  errorPolicy: 'plain', injectStyles: false, styleMode: 'class',
  diffHighlight: (token) => token.meta === 'added' ? { added: [1] } : undefined,
  onError: (_error: unknown, context: HighlightErrorContext) => { void context.stage },
} satisfies HighlightOptions<Grammar, Token, Theme>

const structured: DocumentResult = parseDocument('```js\nconst x = 1;\n```', {
  plugins: [highlightPlugin(options)],
}, { maxStylesheets: 8, maxDiagnostics: 10 })
const structuredParser = createParser({ plugins: [highlightPlugin(options)] })
const rendered: DocumentResult = structuredParser.renderDocument(structuredParser.tokenize('# Heading'))
structured.stylesheets.forEach(asset => { const css: string = asset.css; void css })
structured.diagnostics.forEach(diagnostic => { const index: number | undefined = diagnostic.codeBlock?.index; void index })
// @ts-expect-error Result arrays are immutable.
structured.toc.push({ level: 1, id: 'bad', text: 'bad' })
void rendered

createParser({ plugins: [highlightPlugin(options)] }).parse('```JS\nconst x = 1\n```')
// Existing calls still infer their grammar, token, and theme types without casts.
highlightPlugin({ grammars: [javascript], tokenize, renderToHTML, theme: githubDark })
highlightPlugin({ grammars: [javascript], tokenize, renderToHTML, getThemeStylesheet, theme: 'github-dark' })
// @ts-expect-error Inferred callbacks must agree on the token type too.
highlightPlugin({ grammars: [javascript], tokenize, renderToHTML: (_tokens: { incompatible: true }[]) => '' })

const incompatible: HighlightOptions<Grammar, Token, Theme> = {
  ...options,
  // @ts-expect-error A renderer must consume the actual tokenizer's output.
  renderToHTML: (_tokens: { incompatible: true }[]) => '',
}
const invalidLimit: HighlightOptions<Grammar, Token, Theme> = {
  ...options,
  // @ts-expect-error Resource limits are numeric.
  maxLines: '100',
}
void [incompatible, invalidLimit]

import { parseCodeMetadata, getCodeBlockMetadata, createCodeBlockContext, type CodeBlockRenderHook } from '@lpm.dev/neo.markdown'
import type { RenderHooks } from '@lpm.dev/neo.highlight'
const hooks: RenderHooks = {
  token: context => ({ attributes: { 'data-start': context.start }, class: context.type === 'keyword' ? 'marked' : [] }),
  line: context => ({ attributes: { id: `line-${context.displayLine}` } }),
  pre: context => ({ attributes: { 'aria-label': context.language ?? 'Code' } }),
}
const blockHook: CodeBlockRenderHook = (context, next) => {
  const attrs = getCodeBlockMetadata(context).attributes
  // @ts-expect-error Metadata is a read-only snapshot.
  attrs['title'] = 'mutation'
  void [context.source, context.rawInfo, context.rawMeta, context.lineCount]
  return next()
}
createParser({ renderCodeBlock: blockHook, plugins: [builder => builder.addCodeBlockHook((_context, next) => next()), highlightPlugin({
  grammars: [javascript], tokenize, renderToHTML, hooks,
  renderOptions: context => ({ hooks, startLine: 12, lineNumbers: context.metadata.attributes['lines'] === true }),
})] })
parseCodeMetadata('title="example" {1-3}', 3)
createCodeBlockContext({ type: 'code', raw: '', text: 'x' })
renderToHTML([], { hooks, startLine: 12 })
// @ts-expect-error Decorators cannot return HTML strings.
renderToHTML([], { hooks: { pre: () => '<pre>' } })
// @ts-expect-error Per-block visual configuration cannot replace resource budgets.
const invalidBlockOptions: import('@lpm.dev/neo.markdown/plugins/highlight').HighlightBlockRenderOptions = { maxLines: Infinity }
void invalidBlockOptions

import { codePresentationPlugin, getCodePresentationStyles, type CodePresentationOptions } from '@lpm.dev/neo.markdown/plugins/code-presentation'
codePresentationPlugin({ highlight: { grammars: [javascript], tokenize, renderToHTML, theme: githubDark, hooks: { token: hooks.token } } })
const presentationOptions: CodePresentationOptions<Grammar, Token, Theme> = { highlight: options, maxLines: 100, onDiagnostic: (diagnostics, context) => { void [diagnostics[0]?.field, context.source] } }
createParser({ plugins: [codePresentationPlugin(presentationOptions)] })
getCodePresentationStyles({ classPrefix: 'example' })
// @ts-expect-error The presentation renderer must accept the tokenizer output.
codePresentationPlugin({ highlight: { grammars: [javascript], tokenize, renderToHTML: (_tokens: { incompatible: true }[]) => '' } })

import { normalizeHighlightRanges, MAX_HIGHLIGHT_RANGES, type HighlightRange } from '@lpm.dev/neo.highlight'
const wordRanges: readonly HighlightRange[] = [{ start: 0, end: 5 }]
renderToHTML(tokenize('const x = 1', javascript), { highlightRanges: wordRanges })
highlightPlugin({ grammars: [javascript], tokenize, renderToHTML, highlightRanges: wordRanges, renderOptions: () => ({ highlightRanges: [] }) })
codePresentationPlugin({ highlight: { grammars: [javascript], tokenize, renderToHTML, highlightRanges: wordRanges } })
normalizeHighlightRanges('const x = 1', wordRanges)
void MAX_HIGHLIGHT_RANGES
// @ts-expect-error Source offsets must be numbers.
renderToHTML([], { highlightRanges: [{ start: '0', end: 2 }] })


// Worker entry types remain usable in both package module formats.
import { createMarkdownWorkerClient, type MarkdownWorkerTransport } from '@lpm.dev/neo.markdown/experimental/worker-client'
import { installMarkdownWorker, type MarkdownWorkerScope } from '@lpm.dev/neo.markdown/experimental/worker'
declare const transport: MarkdownWorkerTransport
declare const scope: MarkdownWorkerScope
const workerClient = createMarkdownWorkerClient({ createWorker: () => transport, configuration: { mode: 'safe' } })
const workerUpdate: Promise<string> = workerClient.update('# Worker').then(update => update.result.html)
const removeWorker: () => void = installMarkdownWorker(scope, { configure: () => ({ session: { pluginReuse: 'declared' } }) })
void workerUpdate; void removeWorker
workerClient.dispose()

import { createMarkdownApplication, type MarkdownApplicationOutcome } from '@lpm.dev/neo.markdown/application'
import { createMarkdownSynchronousSession } from '@lpm.dev/neo.markdown/application/sync'
import { createIncrementalMarkdown as stableIncremental } from '@lpm.dev/neo.markdown/incremental'
import { createMarkdownView as stableView } from '@lpm.dev/neo.markdown/dom'
import { installMarkdownWorker as stableWorker } from '@lpm.dev/neo.markdown/worker'
import { createMarkdownWorkerClient as stableWorkerClient } from '@lpm.dev/neo.markdown/worker-client'
const application = createMarkdownApplication({ createFallback: async () => createMarkdownSynchronousSession({ pluginReuse: 'declared' }) })
const applicationUpdate: Promise<MarkdownApplicationOutcome> = application.update('typed')
void applicationUpdate; void stableIncremental; void stableView; void stableWorker; void stableWorkerClient
application.reset(); application.dispose()

import type { MarkdownWorkerClientOptions } from '@lpm.dev/neo.markdown/worker-client'
import type { MarkdownApplicationOptions } from '@lpm.dev/neo.markdown/application'
const deltaOption: Pick<MarkdownWorkerClientOptions, 'htmlDeltas'> = { htmlDeltas: true }
const applicationDeltaOption: Pick<MarkdownApplicationOptions, 'htmlDeltas'> = deltaOption
void applicationDeltaOption

// Source line layout is available through both renderer and Markdown plugin options.
const sourceLinePlugin = highlightPlugin({ grammars: [javascript], tokenize, renderToHTML, wrapLines: 'source', renderOptions: () => ({ wrapLines: false }) })
void sourceLinePlugin
