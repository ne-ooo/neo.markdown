/**
 * Plugin builder implementation
 *
 * Collects plugin configuration during setup, then provides
 * the collected rules/transforms/overrides to the parser.
 */

import type {
  PluginBuilder,
  BlockRule,
  InlineRule,
  BlockToken,
  InlineToken,
  Renderer,
  ParserOptions,
  CodeBlockRenderHook,
} from './types.js'
import type { HtmlRenderer } from './renderer.js'
import type { DocumentCollector } from './document-result.js'

/**
 * Internal plugin builder that collects plugin registrations
 */
export class PluginBuilderImpl implements PluginBuilder {
  readonly options: Readonly<ParserOptions>

  /** Collected custom block rules */
  readonly blockRules: BlockRule[] = []
  /** Collected custom inline rules */
  readonly inlineRules: InlineRule[] = []
  /** Collected renderer overrides (method name → function) */
  readonly rendererOverrides = new Map<keyof Renderer, Renderer[keyof Renderer]>()
  /** Collected token transforms (run after tokenization) */
  readonly tokenTransforms: Array<(tokens: BlockToken[]) => BlockToken[]> = []
  /** Collected HTML transforms (run after rendering) */
  readonly htmlTransforms: Array<(html: string) => string> = []

  readonly codeBlockHooks: CodeBlockRenderHook[] = []

  private renderer: HtmlRenderer
  private collector: DocumentCollector | undefined

  get document() { return this.collector?.context }

  /** Internal call boundary, including tokenization and all transforms. */
  withDocument<T>(collector: DocumentCollector | undefined, render: () => T): T {
    const previous = this.collector
    if (!collector && !previous) return render()
    this.collector = collector
    this.renderer.setDocumentCodeBlockHook(collector?.renderCodeBlock)
    try { return render() } finally {
      collector?.close()
      this.collector = previous
      this.renderer.setDocumentCodeBlockHook(previous?.renderCodeBlock)
    }
  }

  constructor(renderer: HtmlRenderer, options: ParserOptions) {
    this.renderer = renderer
    this.options = Object.freeze({ ...options })
  }

  addBlockRule(rule: BlockRule): void {
    this.blockRules.push(rule)
  }

  addInlineRule(rule: InlineRule): void {
    this.inlineRules.push(rule)
  }

  setRenderer<K extends keyof Renderer>(method: K, fn: Renderer[K]): void {
    this.rendererOverrides.set(method, fn)
  }

  addCodeBlockHook(hook: CodeBlockRenderHook): void {
    this.codeBlockHooks.push(hook)
  }

  addTokenTransform(fn: (tokens: BlockToken[]) => BlockToken[]): void {
    this.tokenTransforms.push(fn)
  }

  addHtmlTransform(fn: (html: string) => string): void {
    this.htmlTransforms.push(fn)
  }

  renderInline(tokens: InlineToken[]): string {
    return this.renderer.renderInline(tokens)
  }

  renderBlock(tokens: BlockToken[]): string {
    return this.renderer.renderBlock(tokens)
  }
}
