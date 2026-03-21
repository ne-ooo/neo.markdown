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
} from './types.js'
import type { HtmlRenderer } from './renderer.js'

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

  private renderer: HtmlRenderer

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
