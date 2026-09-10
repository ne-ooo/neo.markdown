import type { BlockToken } from '../core/types.js'
import { normalizeMarkdown, type BlockCheckpoint, type BlockResume, type BlockContinuationFactory } from '../core/tokenizer.js'
import { consumeTokenBudget, type TokenBudget } from '../core/token-budget.js'

interface RetainedCheckpoint extends BlockCheckpoint { nodes: number; units: number }
interface ContinuationData {
  dependencyEnd: number
  frame: unknown
  child?: { key: number; depth: number; cache: BlockCache }
}

interface GraphSize { nodes: number; units: number }

/** Built-in structural snapshots are immutable. Count shared subgraphs conservatively per reference. */
function sizeOf(value: unknown, sizes: WeakMap<object, GraphSize>): GraphSize {
  if (typeof value === 'string') return { nodes: 0, units: value.length }
  if (!value || typeof value !== 'object') return { nodes: 0, units: 0 }
  const known = sizes.get(value)
  if (known) return known
  const result = { nodes: 1, units: 0 }
  for (const child of Object.values(value)) {
    const size = sizeOf(child, sizes)
    result.nodes += size.nodes + (Array.isArray(value) ? 1 : 0)
    result.units += size.units
  }
  sizes.set(value, result)
  return result
}

/** Dependency ranges include rejected rule probes and lookahead beyond a token's consumed source. */
export class BlockCache {
  private sizes = new WeakMap<object, GraphSize>()
  private source = ''
  private points: RetainedCheckpoint[] = []
  private nodes = 0
  private units = 0
  private parsedCodeUnits = 0
  private reusedCodeUnits = 0
  private parsedBlocks = 0
  private reusedBlocks = 0
  private restart = 0
  private parsedThrough = 0
  private lazy: ReadonlySet<number> | undefined

  constructor(private readonly limits: { checkpoints: number; nodes: number; units: number },
    private readonly charge: (units: number) => void,
    private readonly continuationMetrics = { continuationHits: 0, continuedCodeUnits: 0 }) {}

  clear(): void { this.source = ''; this.points = []; this.nodes = this.units = 0; this.lazy = undefined; this.sizes = new WeakMap() }

  get metrics() {
    return { blockCheckpoints: this.points.length, cachedBlockTokens: this.nodes, cachedBlockCodeUnits: this.units,
      parsedBlockCodeUnits: this.parsedCodeUnits, reusedBlockCodeUnits: this.reusedCodeUnits,
      parsedBlocks: this.parsedBlocks, reusedBlocks: this.reusedBlocks,
      lastBlockRestart: this.restart, lastBlockParsedThrough: this.parsedThrough, ...this.continuationMetrics }
  }

  parse(input: string, budget: TokenBudget | undefined, resume: BlockResume, lazy?: ReadonlySet<number>): BlockToken[] {
    const next = normalizeMarkdown(input)
    const previous = this.source
    const old = this.points
    const tokens: BlockToken[] = []
    let retained: RetainedCheckpoint[] = []
    let nodes = 0, units = 0, keep = this.limits.checkpoints > 0
    const remember = (point: RetainedCheckpoint) => {
      if (!keep) return
      if (retained.length >= this.limits.checkpoints || point.nodes > this.limits.nodes - nodes || point.units > this.limits.units - units) {
        keep = false; retained = []; nodes = units = 0
        return
      }
      retained.push(point); nodes += point.nodes; units += point.units
    }
    const reuse = (point: RetainedCheckpoint, delta = 0) => {
      consumeTokenBudget(budget, point.budgetCost)
      if (point.token) { tokens.push(point.token); this.reusedBlocks++ }
      this.reusedCodeUnits += point.end - point.start
      remember(delta ? { ...point, start: point.start + delta, end: point.end + delta, dependencyEnd: point.dependencyEnd + delta } : point)
    }
    let prefix = 0
    const shortest = Math.min(previous.length, next.length)
    // Appends commonly replace the synthetic final newline. Keep this comparison in the string engine.
    if (next.startsWith(previous)) prefix = previous.length
    else if (previous.endsWith('\n') && next.startsWith(previous.slice(0, -1))) prefix = previous.length - 1
    else while (prefix < shortest && previous.charCodeAt(prefix) === next.charCodeAt(prefix)) prefix++
    let sameLazy = true
    for (const position of this.lazy ?? []) if (!lazy?.has(position)) { prefix = Math.min(prefix, position); sameLazy = false }
    for (const position of lazy ?? []) if (!this.lazy?.has(position)) { prefix = Math.min(prefix, position); sameLazy = false }
    let suffix = 0
    while (suffix < shortest - prefix && previous.charCodeAt(previous.length - 1 - suffix) === next.charCodeAt(next.length - 1 - suffix)) suffix++
    const delta = next.length - previous.length
    for (const position of this.lazy ?? []) if (!lazy?.has(position + delta)) suffix = Math.min(suffix, Math.max(0, previous.length - position - 1))
    for (const position of lazy ?? []) if (!this.lazy?.has(position - delta)) suffix = Math.min(suffix, Math.max(0, next.length - position - 1))
    let prefixCount = 0
    const identical = previous === next && sameLazy
    while (prefixCount < old.length && (identical || old[prefixCount].dependencyEnd <= prefix)) reuse(old[prefixCount++])
    const start = prefixCount ? old[prefixCount - 1].end : 0
    this.restart = start
    this.parsedThrough = start
    const oldEnds = new Map<number, number>()
    const oldStates = new Map<number, ContinuationData>()
    for (let index = prefixCount; index < old.length; index++) {
      const point = old[index]
      oldEnds.set(point.end, index + 1)
      if (point.token && point.continuation) oldStates.set(point.end - point.token.raw.length, point.continuation as ContinuationData)
    }
    let suffixIndex = old.length
    const continuations: BlockContinuationFactory = (cursor, readThrough) => {
      if (!keep) return undefined
      const inSuffix = cursor >= next.length - suffix
      const oldState = oldStates.get(inSuffix ? cursor - delta : cursor)
      const unchanged = inSuffix ? next.length - cursor : Math.max(0, prefix - cursor)
      const valid = oldState && oldState.dependencyEnd <= unchanged
      let frame = valid ? oldState.frame : undefined
      let dependencyEnd = valid ? oldState.dependencyEnd : 0
      let snapshot: (() => unknown) | undefined
      let child = oldState?.child
      const safeEnd = next.lastIndexOf('\n', next.length - 2) + 1 - cursor
      return {
        context: {
          previous: frame,
          retain: create => {
            // Restored scanners skip the saved prefix, including its lookahead.
            // Never replace that dependency with only the fresh start probes.
            const end = Math.max(dependencyEnd, readThrough())
            if (end > safeEnd) return
            dependencyEnd = end; snapshot = create
          },
          reused: units => { this.continuationMetrics.continuationHits++; this.continuationMetrics.continuedCodeUnits += units },
          budget: () => budget?.remaining ?? 0,
        },
        finish: () => {
          if (snapshot) frame = snapshot()
          return frame || child ? { frame, dependencyEnd, child } satisfies ContinuationData : undefined
        },
        tokenize: (source, depth, lines, key, nestedResume) => {
          if (!child || child.key !== key || child.depth !== depth) child = {
            key, depth, cache: new BlockCache(this.limits, this.charge, this.continuationMetrics),
          }
          return child.cache.parse(source, budget, nestedResume, lines)
        },
      }
    }
    const changed = resume(next, start, budget, point => {
      this.parsedThrough = point.end
      this.parsedCodeUnits += point.end - point.start
      this.charge(point.dependencyEnd - point.start)
      if (point.token) this.parsedBlocks++
      if (keep) {
        const size = { ...sizeOf(point.token, this.sizes) }
        const data = point.continuation as ContinuationData | undefined
        if (data) {
          const frame = sizeOf(data.frame, this.sizes)
          size.nodes += frame.nodes + 1; size.units += frame.units
          // Child caches change between updates, so only immutable frames use memoized sizes.
          if (data.child) {
            const child = data.child.cache
            size.nodes += child.nodes + child.points.length + 1 + (child.lazy?.size ?? 0)
            size.units += child.units + child.source.length
          }
        }
        this.charge(size.nodes + size.units)
        remember({ ...point, ...size })
      }
      // Both boundaries have an empty container stack. Everything after them is identical source.
      if (point.end < next.length - suffix) return false
      const index = oldEnds.get(point.end - delta)
      if (index === undefined) return false
      suffixIndex = index
      return true
    }, continuations)
    for (const token of changed) tokens.push(token)
    for (let index = suffixIndex; index < old.length; index++) reuse(old[index], delta)
    if (keep) { this.source = next; this.points = retained; this.nodes = nodes; this.units = units; this.lazy = lazy ? new Set(lazy) : undefined }
    else this.clear()
    return tokens
  }
}
