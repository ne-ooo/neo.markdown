/**
 * Generic block tokenizer.
 *
 * Built-in Markdown rules live in `../blocks/rules.ts`. This engine only
 * orders, validates, and composes the rules supplied by a parser entry point.
 */

import type {
  BlockRule,
  BlockRuleContext,
  BlockToken,
  ParserOptions,
} from './types.js'
import { consumeTokenBudget, type TokenBudget } from './token-budget.js'

interface InternalBlockRule {
  rule: BlockRule
  priority: number
  order: number
}

/** Internal top-level reset point. Positions refer to normalized Markdown. */
export interface BlockCheckpoint {
  start: number
  end: number
  dependencyEnd: number
  budgetCost: number
  token?: BlockToken
  continuation?: unknown
}

export type BlockResume = (src: string, start: number, budget: TokenBudget | undefined,
  checkpoint: (point: BlockCheckpoint) => boolean, continuations?: BlockContinuationFactory) => BlockToken[]
export interface BlockContinuationScope {
  context: NonNullable<BlockRuleContext['continuation']>
  finish(): unknown
  tokenize(src: string, depth: number, lazy: ReadonlySet<number> | undefined, key: number, resume: BlockResume): BlockToken[]
}
export type BlockContinuationFactory = (cursor: number, readThrough: () => number) => BlockContinuationScope | undefined

export function normalizeMarkdown(src: string): string {
  const text = src.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\0/g, '\ufffd')
  return text && !text.endsWith('\n') ? text + '\n' : text
}

const DEFAULT_MAX_NESTING_DEPTH = 100
const HARD_MAX_NESTING_DEPTH = 100
const DEFAULT_CUSTOM_PRIORITY = 150

/** Parse Markdown into block tokens using only the supplied rules. */
export class Tokenizer {
  private readonly options: Readonly<ParserOptions>
  private readonly rules: InternalBlockRule[]
  private readonly maxNestingDepth: number

  constructor(
    options: ParserOptions = {},
    blockRules: BlockRule[] = [],
    customRules: BlockRule[] = []
  ) {
    this.options = options
    this.maxNestingDepth = this.resolveMaxNestingDepth(options.maxNestingDepth)
    this.rules = this.buildRules(blockRules, customRules)
  }

  private resolveMaxNestingDepth(configuredDepth: number | undefined): number {
    if (configuredDepth === undefined) return DEFAULT_MAX_NESTING_DEPTH
    if (!Number.isSafeInteger(configuredDepth) || configuredDepth < 0) {
      return DEFAULT_MAX_NESTING_DEPTH
    }
    return Math.min(configuredDepth, HARD_MAX_NESTING_DEPTH)
  }

  private buildRules(blockRules: BlockRule[], customRules: BlockRule[]): InternalBlockRule[] {
    const resolved: InternalBlockRule[] = blockRules.map((rule, order) => ({
      rule,
      priority: typeof rule.priority === 'number' && Number.isFinite(rule.priority)
        ? rule.priority
        : DEFAULT_CUSTOM_PRIORITY,
      order,
    }))

    for (const rule of customRules) {
      resolved.push({
        rule,
        priority: this.resolveRulePriority(rule, resolved),
        order: resolved.length,
      })
    }

    return resolved.sort((left, right) => (
      right.priority - left.priority || left.order - right.order
    ))
  }

  private resolveRulePriority(rule: BlockRule, existing: InternalBlockRule[]): number {
    if (rule.priority === undefined) return DEFAULT_CUSTOM_PRIORITY
    if (typeof rule.priority === 'number') {
      return Number.isFinite(rule.priority) ? rule.priority : DEFAULT_CUSTOM_PRIORITY
    }

    const separator = rule.priority.indexOf(':')
    const position = rule.priority.slice(0, separator)
    const targetName = rule.priority.slice(separator + 1)
    const target = existing.find((candidate) => candidate.rule.name === targetName)
    if (!target) return DEFAULT_CUSTOM_PRIORITY
    return position === 'before' ? target.priority + 1 : target.priority - 1
  }

  /** Tokenize a complete Markdown document. */
  tokenize(src: string, tokenBudget?: TokenBudget): BlockToken[] {
    return this.tokenizeInternal(src, 0, tokenBudget)
  }

  /** Internal experimental entry. Resume at a previously observed top-level boundary. */
  resume(src: string, start: number, tokenBudget: TokenBudget | undefined,
    checkpoint: (point: BlockCheckpoint) => boolean, continuations?: BlockContinuationFactory): BlockToken[] {
    return this.tokenizeInternal(src, 0, tokenBudget, undefined, start, checkpoint, continuations)
  }

  private tokenizeInternal(
    src: string,
    depth: number,
    tokenBudget?: TokenBudget,
    lazyLines?: ReadonlySet<number>,
    start = 0,
    checkpoint?: (point: BlockCheckpoint) => boolean,
    continuations?: BlockContinuationFactory
  ): BlockToken[] {
    const markdown = normalizeMarkdown(src)

    const tokens: BlockToken[] = []
    let cursor = start
    let checkpointStart = start
    let previousBudget = tokenBudget?.remaining ?? 0
    let dependencyEnd = start

    while (cursor < markdown.length) {
      if (markdown.charCodeAt(cursor) === 10) {
        cursor++
        continue
      }

      const remaining = markdown.slice(cursor)
      const observe = checkpoint ? (end: number) => { dependencyEnd = Math.max(dependencyEnd, Math.min(markdown.length + 1, cursor + end)) } : undefined
      // Every built-in start probe reads at most two lines. Longer reads report their own dependencies.
      if (observe) {
        const first = remaining.indexOf('\n')
        const second = first < 0 ? -1 : remaining.indexOf('\n', first + 1)
        observe(second < 0 ? remaining.length + 1 : second + 1)
      }
      const scope = continuations?.(cursor, () => dependencyEnd - cursor)
      const context = this.createContext(depth, tokenBudget, cursor, lazyLines, observe, remaining.length, scope)
      let consumed = 0
      let token: BlockToken | undefined

      for (const candidate of this.rules) {
        const result = candidate.rule.tokenize(remaining, this.options, context)
        if (!result) continue

        this.assertProgress(candidate.rule.name, remaining, result.raw)
        consumeTokenBudget(tokenBudget)
        tokens.push(result.token)
        token = result.token
        consumed = result.raw.length
        break
      }

      // A parser with a selective rule set can intentionally leave syntax
      // unmatched. Advance one code unit so malformed/custom input terminates.
      cursor += consumed || 1
      if (checkpoint && token) {
        const point = { start: checkpointStart, end: cursor, dependencyEnd: Math.max(dependencyEnd, cursor + 1),
          budgetCost: previousBudget - (tokenBudget?.remaining ?? 0), token, ...(scope ? { continuation: scope.finish() } : {}) }
        if (checkpoint(point)) return tokens
        checkpointStart = cursor
        previousBudget = tokenBudget?.remaining ?? 0
        dependencyEnd = cursor
      }
    }

    if (checkpoint && checkpointStart < cursor) checkpoint({ start: checkpointStart, end: cursor,
      dependencyEnd: markdown.length + 1, budgetCost: previousBudget - (tokenBudget?.remaining ?? 0) })

    return tokens
  }

  private createContext(depth: number, tokenBudget?: TokenBudget, cursor = 0, lazyLines?: ReadonlySet<number>,
    observe?: (end: number) => void, length = 0, scope?: BlockContinuationScope): BlockRuleContext {
    return {
      depth,
      maxNestingDepth: this.maxNestingDepth,
      tokenize: (src, nestedDepth, lazy, key = 0) => scope
        ? scope.tokenize(src, nestedDepth, lazy, key, (source, start, budget, checkpoint, continuations) =>
          this.tokenizeInternal(source, nestedDepth, budget, lazy, start, checkpoint, continuations))
        : this.tokenizeInternal(src, nestedDepth, tokenBudget, lazy),
      isLazyLine: (offset) => lazyLines?.has(cursor + offset) ?? false,
      interruptsParagraph: (src, paragraphPriority, excludedRule) => {
        if (observe) {
          const first = src.indexOf('\n')
          const second = first < 0 ? -1 : src.indexOf('\n', first + 1)
          observe(length - src.length + (second < 0 ? src.length + 1 : second + 1))
        }
        return this.interruptsParagraph(src, paragraphPriority, excludedRule)
      },
      consumeTokens: (count = 1) => consumeTokenBudget(tokenBudget, count),
      ...(observe ? { dependOn: observe } : {}),
      ...(scope ? { continuation: scope.context } : {}),
    }
  }

  private interruptsParagraph(src: string, paragraphPriority: number, excludedRule?: string): boolean {
    for (const candidate of this.rules) {
      if (candidate.priority <= paragraphPriority || candidate.rule.name === excludedRule) continue
      if (candidate.rule.starts?.(src, this.options)) return true
    }
    return false
  }

  private assertProgress(ruleName: string, src: string, raw: string): void {
    if (typeof raw !== 'string' || raw.length === 0) {
      throw new TypeError(`Block rule "${ruleName}" must consume a non-empty prefix`)
    }
    if (!src.startsWith(raw)) {
      throw new TypeError(`Block rule "${ruleName}" returned raw text that is not a source prefix`)
    }
  }
}
