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

/**
 * Returns tokens to the budget when built tokens go away, as when adjacent
 * text merges or a delimiter run is used up. Charging tokens as they are
 * built and returning them as they go keeps the budget's count at the live
 * token count, so a document can't build far more than the limit before
 * its tokens are counted.
 */
export function releaseTokenBudget(
  budget: TokenBudget | undefined,
  count = 1
): void {
  // Only charged tokens return, so the budget never passes its limit.
  if (budget) budget.remaining = Math.min(budget.limit, budget.remaining + count)
}
