/** Internal parser-wide token budget used by UGC mode. */

export const MAX_UGC_TOKEN_COUNT = 50_000

export interface TokenBudget {
  readonly limit: number
  remaining: number
}

export function createTokenBudget(limit = MAX_UGC_TOKEN_COUNT): TokenBudget {
  return { limit, remaining: limit }
}

export function consumeTokenBudget(
  budget: TokenBudget | undefined,
  count = 1
): void {
  if (!budget) return
  if (budget.remaining < count) {
    throw new RangeError(`Markdown token count exceeds UGC limit ${budget.limit}`)
  }
  budget.remaining -= count
}
