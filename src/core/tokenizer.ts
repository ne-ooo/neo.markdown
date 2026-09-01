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

  private tokenizeInternal(
    src: string,
    depth: number,
    tokenBudget?: TokenBudget
  ): BlockToken[] {
    let markdown = src.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    if (markdown && !markdown.endsWith('\n')) markdown += '\n'

    const tokens: BlockToken[] = []
    let cursor = 0

    while (cursor < markdown.length) {
      if (markdown.charCodeAt(cursor) === 10) {
        cursor++
        continue
      }

      const remaining = markdown.slice(cursor)
      const context = this.createContext(depth, tokenBudget)
      let consumed = 0

      for (const candidate of this.rules) {
        const result = candidate.rule.tokenize(remaining, this.options, context)
        if (!result) continue

        this.assertProgress(candidate.rule.name, remaining, result.raw)
        consumeTokenBudget(tokenBudget)
        tokens.push(result.token)
        consumed = result.raw.length
        break
      }

      // A parser with a selective rule set can intentionally leave syntax
      // unmatched. Advance one code unit so malformed/custom input terminates.
      cursor += consumed || 1
    }

    return tokens
  }

  private createContext(depth: number, tokenBudget?: TokenBudget): BlockRuleContext {
    return {
      depth,
      maxNestingDepth: this.maxNestingDepth,
      tokenize: (src, nestedDepth) => this.tokenizeInternal(src, nestedDepth, tokenBudget),
      interruptsParagraph: (src, paragraphPriority) => (
        this.interruptsParagraph(src, paragraphPriority)
      ),
      consumeTokens: (count = 1) => consumeTokenBudget(tokenBudget, count),
    }
  }

  private interruptsParagraph(src: string, paragraphPriority: number): boolean {
    for (const candidate of this.rules) {
      if (candidate.priority <= paragraphPriority) continue
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
