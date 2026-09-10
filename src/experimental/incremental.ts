import { MarkdownParser } from '../core/parser.js'
import { allBlockRules } from '../blocks/rules.js'
import { consumeTokenBudget, type TokenBudget } from '../core/token-budget.js'
import { BlockCache } from './block-cache.js'
import { preparePluginReuse, type IncrementalReusePolicy } from './plugin-contract.js'
import { isolateTokens } from './isolate-tokens.js'
import { ReferenceTracker } from './reference-tracker.js'
import { snapshotTokens } from './snapshot-tokens.js'
import { IncrementalMarkdownLimitError } from './limit-error.js'
import type { PluginRuntime } from './plugin-runtime.js'
import type { ParserOptions, BlockToken, InlineToken, LinkReference, DocumentOptions, DocumentResult } from '../core/types.js'

export interface IncrementalMarkdownOptions {
  parser?: ParserOptions
  pluginReuse?: 'off' | 'declared'
  maxInputLength?: number
  maxUpdates?: number
  maxWorkCodeUnits?: number
  maxCachedCodeUnits?: number
  maxCachedTokens?: number
  maxCachedTokenCodeUnits?: number
  maxEntries?: number
  maxBlockCheckpoints?: number
  maxCachedBlockTokens?: number
  maxCachedBlockCodeUnits?: number
  maxCachedReferenceDependencies?: number
}
interface Cached {
  tokens: InlineToken[]; budgetCost: number; count: number; units: number
  references: ReadonlyMap<string, LinkReference | undefined>; wholeMapRead: boolean
}
function bounded(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${name} must be a non-negative safe integer`)
  return value
}
function sizeOf(tokens: InlineToken[]): { count: number; units: number } {
  let count = 0, units = 0
  const stack = [...tokens]
  while (stack.length) {
    const token = stack.pop()!
    count++
    for (const value of Object.values(token)) if (typeof value === 'string') units += value.length
    if ('tokens' in token) for (const child of token.tokens) stack.push(child)
  }
  return { count, units }
}

/** Resume block parsing at dependency-safe checkpoints and render a complete document result. */
export function createIncrementalMarkdown(options: IncrementalMarkdownOptions = {}): {
  update(source: string, documentOptions?: DocumentOptions): DocumentResult
  append(chunk: string, documentOptions?: DocumentOptions): DocumentResult
  dispose(): void
  readonly reuse: IncrementalReusePolicy
  readonly metrics: {
    updates: number; sourceLength: number; workCodeUnits: number; parsedInlineCodeUnits: number;
    reusedInlineCodeUnits: number; cacheEntries: number; cachedCodeUnits: number; cachedTokens: number; cachedTokenCodeUnits: number; referenceInvalidations: number
    blockCheckpoints: number; cachedBlockTokens: number; cachedBlockCodeUnits: number
    parsedBlockCodeUnits: number; reusedBlockCodeUnits: number; parsedBlocks: number; reusedBlocks: number
    lastBlockRestart: number; lastBlockParsedThrough: number
    cachedReferenceDependencies: number; invalidatedInlineEntries: number
    continuationHits: number; continuedCodeUnits: number
    clonedTokenNodes: number; clonedTokenCodeUnits: number
    pluginInvalidations: number
  }
} {
  const requested = options.pluginReuse ?? 'off'
  if (requested !== 'off' && requested !== 'declared') throw new TypeError('pluginReuse must be off or declared')
  const maxInput = bounded(options.maxInputLength ?? 250_000, 'maxInputLength')
  const maxUpdates = bounded(options.maxUpdates ?? 10_000, 'maxUpdates')
  const maxWork = bounded(options.maxWorkCodeUnits ?? 16_000_000, 'maxWorkCodeUnits')
  const maxCached = bounded(options.maxCachedCodeUnits ?? 128_000, 'maxCachedCodeUnits')
  const maxNodes = bounded(options.maxCachedTokens ?? 50_000, 'maxCachedTokens')
  const maxTokenUnits = bounded(options.maxCachedTokenCodeUnits ?? 1_000_000, 'maxCachedTokenCodeUnits')
  const maxEntries = bounded(options.maxEntries ?? 512, 'maxEntries')
  const maxReferences = bounded(options.maxCachedReferenceDependencies ?? 10_000, 'maxCachedReferenceDependencies')
  const blocks = new BlockCache({
    checkpoints: bounded(options.maxBlockCheckpoints ?? 4096, 'maxBlockCheckpoints'),
    nodes: bounded(options.maxCachedBlockTokens ?? 50_000, 'maxCachedBlockTokens'),
    units: bounded(options.maxCachedBlockCodeUnits ?? 1_000_000, 'maxCachedBlockCodeUnits'),
  }, charge)
  const parserOptions = { ...options.parser, maxInputLength: Math.min(maxInput, options.parser?.maxInputLength ?? maxInput) }
  const parserInputLimit = Math.min(parserOptions.maxInputLength, parserOptions.ugc ? 1_000_000 : Infinity)
  let reusable = false, isolated = false, updating = false
  const cloneMetrics = { clonedTokenNodes: 0, clonedTokenCodeUnits: 0 }
  const cache = new Map<string, Cached>()
  let parser: ReusingParser | undefined
  let runtime: PluginRuntime | undefined, revisions: string[] | undefined, pluginInvalidations = 0
  let source = '', closed = false, updates = 0, workCodeUnits = 0, parsedInlineCodeUnits = 0, reusedInlineCodeUnits = 0
  let cachedCodeUnits = 0, cachedTokens = 0, cachedTokenCodeUnits = 0, referenceInvalidations = 0
  let cachedReferenceDependencies = 0, invalidatedInlineEntries = 0
  let referencesObject: ReadonlyMap<string, LinkReference> | undefined, referenceKey: string | undefined
  function clear(): void { cache.clear(); cachedCodeUnits = 0; cachedTokens = 0; cachedTokenCodeUnits = 0; cachedReferenceDependencies = 0 }
  function remove(text: string, entry: Cached): void {
    cache.delete(text); cachedCodeUnits -= text.length; cachedTokens -= entry.count; cachedTokenCodeUnits -= entry.units
    cachedReferenceDependencies -= entry.references.size
  }
  function release(): void { closed = true; parser = undefined; source = ''; revisions = undefined; runtime?.dispose(); referencesObject = undefined; referenceKey = undefined; clear(); blocks.clear() }
  function checkOpen(): void { if (closed) throw new Error('Incremental Markdown session is closed') }
  function charge(size: number): void {
    if (size > maxWork - workCodeUnits) throw new IncrementalMarkdownLimitError('maxWorkCodeUnits')
    workCodeUnits += size
  }
  class ReusingParser extends MarkdownParser {
    protected override tokenizeBlocks(text: string, budget?: TokenBudget): BlockToken[] {
      if (!reusable) return super.tokenizeBlocks(text, budget)
      const tokens = blocks.parse(text, budget, (source, start, budget, checkpoint, continuations) => this.resumeBlocks(source, start, budget, checkpoint, continuations))
      return isolated ? isolateTokens(tokens, charge, cloneMetrics) : tokens
    }
    protected override tokenizeInline(text: string, references: ReadonlyMap<string, LinkReference>, budget?: TokenBudget): InlineToken[] {
      if (!reusable) { parsedInlineCodeUnits += text.length; return super.tokenizeInline(text, references, budget) }
      if (referencesObject !== references) {
        const key = JSON.stringify([...references])
        charge(key.length)
        if (referenceKey !== undefined && key !== referenceKey) {
          referenceInvalidations++
          for (const [text, entry] of cache) {
            let affected = entry.wholeMapRead
            for (const [label, previous] of entry.references) {
              const next = references.get(label)
              charge(label.length + 1)
              if (previous?.href !== next?.href || previous?.title !== next?.title) { affected = true; break }
            }
            if (affected) { remove(text, entry); invalidatedInlineEntries++ }
          }
        }
        referenceKey = key; referencesObject = references
      }
      const previous = cache.get(text)
      if (previous) {
        consumeTokenBudget(budget, previous.budgetCost)
        charge(text.length + previous.units + previous.count)
        reusedInlineCodeUnits += text.length
        cache.delete(text); cache.set(text, previous)
        // Each occurrence gets its own graph. Repeated text must not introduce observable aliases.
        return isolated ? isolateTokens(previous.tokens, charge, cloneMetrics) : previous.tokens
      }
      const remaining = budget?.remaining ?? 0
      const tracked = new ReferenceTracker(references, maxReferences, maxTokenUnits, charge)
      runtime!.cacheableInline = true
      const tokens = runtime!.hasInlineRules
        ? runtime!.guarded(() => super.tokenizeInline(text, tracked, budget))
        : super.tokenizeInline(text, tracked, budget)
      parsedInlineCodeUnits += text.length
      const custom = runtime!.hasInlineRules
      if (custom && (!runtime!.cacheableInline || !tracked.cacheable || !maxEntries || text.length > maxCached)) {
        charge(text.length); return tokens
      }
      // Custom token graphs can contain extension data. Inspect descriptors and take an owned snapshot,
      // or render the original uncached graph without a second rule call.
      const snapshot = custom ? runtime!.guarded(() => snapshotTokens(tokens, maxNodes, maxTokenUnits - tracked.units, charge, cloneMetrics)) : undefined
      if (custom && !snapshot) return tokens
      const { count, units: tokenUnits } = snapshot ?? sizeOf(tokens)
      const units = tokenUnits + tracked.units
      charge(text.length + units + count)
      if (!tracked.cacheable || text.length > maxCached || count > maxNodes || units > maxTokenUnits || !maxEntries) return tokens
      while (cache.size && (cache.size >= maxEntries || cachedCodeUnits + text.length > maxCached || cachedTokens + count > maxNodes
        || cachedTokenCodeUnits + units > maxTokenUnits || cachedReferenceDependencies + tracked.dependencies.size > maxReferences)) {
        const first = cache.keys().next().value!
        const removed = cache.get(first)!
        remove(first, removed)
      }
      cache.set(text, { tokens: snapshot?.tokens ?? tokens, budgetCost: remaining - (budget?.remaining ?? 0), count, units,
        references: tracked.dependencies, wholeMapRead: tracked.wholeMapRead })
      cachedCodeUnits += text.length; cachedTokens += count; cachedTokenCodeUnits += units
      cachedReferenceDependencies += tracked.dependencies.size
      return isolated && !custom ? isolateTokens(tokens, charge, cloneMetrics) : tokens
    }
  }
  const preparation = preparePluginReuse(parserOptions, requested, message => {
    release()
    throw new TypeError(message)
  }, checkOpen)
  runtime = preparation.runtime
  const preparedOptions = preparation.plugins === parserOptions.plugins ? parserOptions : { ...parserOptions, plugins: preparation.plugins }
  try { parser = new ReusingParser(preparedOptions, parserOptions.blocks ?? allBlockRules) }
  catch (error) { preparation.finish(); release(); throw error }
  const reuse = preparation.finish()
  reusable = reuse.mode !== 'fallback'
  isolated = reuse.mode === 'declared'
  function update(next: string, documentOptions?: DocumentOptions): DocumentResult {
    if (closed) throw new Error('Incremental Markdown session is closed')
    if (isolated && updating) { release(); throw new TypeError('Incremental Markdown update is reentrant') }
    if (typeof next !== 'string') throw new TypeError('Markdown source must be a string')
    try {
      updating = true
      if (updates >= maxUpdates) throw new IncrementalMarkdownLimitError('maxUpdates')
      if (next.length > maxInput) throw new IncrementalMarkdownLimitError('maxInputLength')
      if (isolated && next.length > parserInputLimit) {
        throw new RangeError(`Markdown input length ${next.length} exceeds maxInputLength ${parserInputLimit}`)
      }
      charge(next.length * 3) // Source-unit accounting includes retention, block parsing, and rendering. It is not a CPU instruction count.
      if (isolated) {
        const nextRevisions = runtime!.revisions(charge)
        if (revisions && nextRevisions.some((revision, index) => revision !== revisions![index])) {
          clear(); referencesObject = undefined; referenceKey = undefined; pluginInvalidations++
        }
        revisions = nextRevisions
      }
      const result = parser!.parseDocument(next, documentOptions)
      if (closed) throw new Error('Incremental Markdown session is closed')
      source = next; updates++
      return result
    } catch (error) { release(); throw error } finally { updating = false }
  }
  return {
    update,
    append(chunk, documentOptions) {
      if (closed) throw new Error('Incremental Markdown session is closed')
      if (isolated && updating) { release(); throw new TypeError('Incremental Markdown update is reentrant') }
      if (typeof chunk !== 'string') throw new TypeError('Markdown chunk must be a string')
      if (chunk.length > maxInput - source.length) { release(); throw new IncrementalMarkdownLimitError('maxInputLength') }
      return update(source + chunk, documentOptions)
    },
    dispose: release,
    get reuse() { return reuse },
    get metrics() { return { updates, sourceLength: source.length, workCodeUnits, parsedInlineCodeUnits, reusedInlineCodeUnits,
      cacheEntries: cache.size, cachedCodeUnits, cachedTokens, cachedTokenCodeUnits, referenceInvalidations,
      cachedReferenceDependencies, invalidatedInlineEntries, pluginInvalidations, ...blocks.metrics, ...cloneMetrics } },
  }
}
