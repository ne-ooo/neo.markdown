import type { MarkdownPlugin, ParserOptions, PluginBuilder } from '../core/types.js'
import { PluginRuntime } from './plugin-runtime.js'
import { snapshotInlineRule } from './inline-rule.js'

export type InlineDependencies =
  | { readonly kind: 'static' }
  | { readonly kind: 'revision'; readonly read: () => string }

/** Inline rules assert deterministic results and no observable effects under their declared dependencies. */
export type IncrementalPluginContract = {
  readonly protocol: 1
  readonly id: string
} & (
  | { readonly profile: 'render' }
  | { readonly profile: 'inline'; readonly effects: 'none'; readonly dependencies: InlineDependencies }
)
export type ReuseBlockerCode = 'plugin-reuse-off' | 'undeclared-plugin' | 'unsupported-contract' | 'duplicate-plugin-id'
  | 'caller-block-rules' | 'caller-renderer' | 'custom-block-rules' | 'registration-mismatch' | 'contract-limit'
export interface IncrementalReusePolicy {
  readonly mode: 'built-in' | 'declared' | 'fallback'
  readonly truncated: boolean
  readonly blockers: readonly { readonly code: ReuseBlockerCode; readonly pluginIndex?: number; readonly pluginId?: string }[]
}

// Module-local identity deliberately rejects declarations from other installed copies or module formats.
const declarations = new WeakMap<MarkdownPlugin, IncrementalPluginContract>()
function fields(value: unknown, names: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Reflect.ownKeys(value).some(key => typeof key !== 'string' || !names.includes(key))) {
    throw new TypeError('Invalid incremental plugin contract')
  }
  const result: Record<string, unknown> = {}
  for (const name of names) {
    const descriptor = Object.getOwnPropertyDescriptor(value, name)
    if (descriptor && !('value' in descriptor)) throw new TypeError('Incremental plugin contracts require data properties')
    result[name] = descriptor?.value
  }
  return result
}

/** Declare setup capabilities without changing ordinary plugin execution or enabling reuse. */
export function defineIncrementalPlugin(plugin: MarkdownPlugin, contract: IncrementalPluginContract): MarkdownPlugin {
  if (typeof plugin !== 'function') throw new TypeError('Incremental plugin must be a function')
  const data = fields(contract, ['protocol', 'id', 'profile', 'effects', 'dependencies'])
  if (data.protocol !== 1 || typeof data.id !== 'string' || !data.id.length || data.id.length > 128) {
    throw new TypeError('Incremental plugin contract requires protocol 1 and an ID of 1–128 UTF-16 units')
  }
  let snapshot: IncrementalPluginContract
  if (data.profile === 'render' && data.effects === undefined && data.dependencies === undefined) {
    snapshot = { protocol: 1, id: data.id, profile: 'render' }
  } else if (data.profile === 'inline' && data.effects === 'none') {
    const dependency = fields(data.dependencies, ['kind', 'read'])
    let dependencies: InlineDependencies
    if (dependency.kind === 'static' && dependency.read === undefined) dependencies = { kind: 'static' }
    else if (dependency.kind === 'revision' && typeof dependency.read === 'function') {
      dependencies = { kind: 'revision', read: dependency.read as () => string }
    } else throw new TypeError('Invalid incremental inline dependencies')
    snapshot = { protocol: 1, id: data.id, profile: 'inline', effects: 'none', dependencies: Object.freeze(dependencies) }
  } else throw new TypeError('Invalid incremental plugin profile')
  const wrapped: MarkdownPlugin = builder => plugin(builder)
  declarations.set(wrapped, Object.freeze(snapshot))
  return wrapped
}

/** Audit the real setup once. Facades expose the documented builder API, never private registration arrays. */
export function preparePluginReuse(options: ParserOptions, requested: 'off' | 'declared', fail: (message: string) => never, checkOpen: () => void): {
  plugins: MarkdownPlugin[] | undefined
  runtime: PluginRuntime
  finish(): IncrementalReusePolicy
} {
  const plugins = options.plugins?.slice()
  const blockers: Array<IncrementalReusePolicy['blockers'][number]> = []
  let truncated = false, finished = false, enabled = false, registrations = 0
  let policy: IncrementalReusePolicy | undefined
  const runtime = new PluginRuntime(fail, checkOpen)
  let metadataUnits = 0
  const block = (code: ReuseBlockerCode, pluginIndex?: number, pluginId?: string) => {
    if (blockers.length < 16) blockers.push(Object.freeze({ code,
      ...(pluginIndex === undefined ? {} : { pluginIndex }), ...(pluginId === undefined ? {} : { pluginId }) }))
    else truncated = true
  }
  if (options.blocks) block('caller-block-rules')
  if (options.renderer) block('caller-renderer')
  if (plugins?.length) {
    if (requested === 'off') block('plugin-reuse-off')
    else if (plugins.length > 64) block('contract-limit')
    else {
      const ids = new Set<string>()
      for (const [index, plugin] of plugins.entries()) {
        const declaration = declarations.get(plugin)
        if (!declaration) { block('undeclared-plugin', index); continue }
        if (ids.has(declaration.id)) block('duplicate-plugin-id', index, declaration.id)
        ids.add(declaration.id)
      }
    }
  }
  const audit = !blockers.length && Boolean(plugins?.length)
  let publicOptions: Readonly<ParserOptions> | undefined
  if (audit) Object.freeze(plugins)
  const prepared = audit ? plugins!.map((plugin, index): MarkdownPlugin => builder => {
    publicOptions ??= Object.freeze({ ...builder.options, plugins })
    let setup = true
    const declaration = declarations.get(plugin)!
    const { id } = declaration
    if (declaration.profile === 'inline' && declaration.dependencies.kind === 'revision') runtime.addRevision(declaration.dependencies.read)
    const register = (kind: 'block' | 'inline' | 'render', action: () => void) => {
      if (finished) { if (enabled) fail('Incremental Markdown plugin registration is closed'); action(); return }
      if (!setup) block('registration-mismatch', index, id)
      if (++registrations === 1025) block('contract-limit')
      if (kind === 'block') block('custom-block-rules', index, id)
      if (kind === 'inline' && declaration.profile !== 'inline') block('registration-mismatch', index, id)
      action()
    }
    const renderInline: PluginBuilder['renderInline'] = tokens => { runtime.guardService(); return builder.renderInline(tokens) }
    const renderBlock: PluginBuilder['renderBlock'] = tokens => { runtime.guardService(); return builder.renderBlock(tokens) }
    const facade: PluginBuilder = Object.freeze({
      get options() { return publicOptions! },
      get document() { runtime.guardService(); return builder.document },
      addBlockRule: rule => register('block', () => builder.addBlockRule(rule)),
      addInlineRule: rule => register('inline', () => {
        if (finished || blockers.length) { builder.addInlineRule(rule); return }
        const snapshot = snapshotInlineRule(rule, 65_536 - metadataUnits)
        if (typeof snapshot === 'string') { block(snapshot === 'limit' ? 'contract-limit' : 'registration-mismatch', index, id); builder.addInlineRule(rule); return }
        metadataUnits += snapshot.units
        runtime.hasInlineRules = true
        const selected = () => (finished ? enabled : !blockers.length) ? snapshot.rule : rule
        builder.addInlineRule({
          get name() { return selected().name },
          get priority() { return selected().priority },
          get triggerChars() { return selected().triggerChars },
          tokenize: source => runtime.enabled
            ? runtime.guarded(() => {
              const result = snapshot.rule.tokenize(source)
              runtime.observeResult(result)
              return result
            })
            : rule.tokenize(source),
        })
      }),
      addTokenTransform: transform => register('render', () => builder.addTokenTransform(transform)),
      addHtmlTransform: transform => register('render', () => builder.addHtmlTransform(transform)),
      addCodeBlockHook: hook => register('render', () => builder.addCodeBlockHook(hook)),
      setRenderer: (method, render) => register('render', () => builder.setRenderer(method, render)),
      get renderInline() { runtime.guardService(); return renderInline },
      get renderBlock() { runtime.guardService(); return renderBlock },
    } satisfies PluginBuilder)
    try { plugin(facade) } finally { setup = false }
  }) : options.plugins
  // Prevent a declared setup from appending unobserved plugins to the parser's active iteration.
  if (audit) Object.freeze(prepared)
  return {
    plugins: prepared,
    runtime,
    finish() {
      if (!policy) {
        finished = true; enabled = audit && !blockers.length
        runtime.enabled = enabled
        if (!enabled) runtime.dispose()
        policy = Object.freeze({ mode: blockers.length ? 'fallback' : enabled ? 'declared' : 'built-in',
          blockers: Object.freeze(blockers), truncated })
      }
      return policy
    },
  }
}
