/** Copy private built-in or inspected snapshot graphs before exposing them to render plugins. */
export function isolateTokens<T>(input: T, charge: (units: number) => void,
  metrics: { clonedTokenNodes: number; clonedTokenCodeUnits: number }): T {
  const copies = new Map<object, object>()
  function copy(value: unknown): unknown {
    if (typeof value === 'string') {
      charge(value.length); metrics.clonedTokenCodeUnits += value.length
      return value
    }
    if (!value || typeof value !== 'object') return value
    const previous = copies.get(value)
    if (previous) return previous
    charge(1); metrics.clonedTokenNodes++
    const result = (Array.isArray(value) ? new Array(value.length) : Object.create(Object.getPrototypeOf(value))) as Record<string, unknown>
    copies.set(value, result)
    for (const key of Object.keys(value)) {
      const child = (value as Record<string, unknown>)[key]
      charge(1)
      // Private cached records have data properties. Defining keys also avoids prototype setters.
      if (key === '__proto__') Object.defineProperty(result, key, { value: copy(child), writable: true, enumerable: true, configurable: true })
      else result[key] = copy(child)
    }
    return result
  }
  return copy(input) as T
}
