/** Internal parser-wide token budget: UGC mode's, or the one `maxTokens` sets. */

export const MAX_UGC_TOKEN_COUNT = 50_000

export interface TokenBudget {
  readonly limit: number
  /** The limit's name in the error, `UGC limit` or `maxTokens`. */
  readonly name: string
  remaining: number
}

export function createTokenBudget(limit = MAX_UGC_TOKEN_COUNT, name = 'UGC limit'): TokenBudget {
  return { limit, name, remaining: limit }
}

export function consumeTokenBudget(
  budget: TokenBudget | undefined,
  count = 1
): void {
  if (!budget) return
  if (budget.remaining < count) {
    throw new RangeError(`Markdown token count exceeds ${budget.name} ${budget.limit}`)
  }
  budget.remaining -= count
}
