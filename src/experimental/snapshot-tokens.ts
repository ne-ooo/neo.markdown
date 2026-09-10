import type { InlineToken } from '../core/types.js'

/** Snapshot plugin output before downstream callbacks. Unsupported graphs remain uncached and are never retried. */
export function snapshotTokens(tokens: InlineToken[], maxNodes: number, maxUnits: number, charge: (units: number) => void,
  metrics: { clonedTokenNodes: number; clonedTokenCodeUnits: number }): { tokens: InlineToken[]; count: number; units: number } | undefined {
  const copies = new Map<object, object>(), active = new Set<object>()
  let count = 0, units = 0, supported = true
  function add(nodes: number, strings: number): boolean {
    // Capacity rejection inspects a size but does not copy the rejected contents.
    if (nodes > maxNodes - count || strings > maxUnits - units) { charge(1); supported = false; return false }
    charge(nodes + strings)
    count += nodes; units += strings
    return supported
  }
  function copy(value: unknown, depth: number): unknown {
    if (!supported) return undefined
    if (typeof value === 'string') {
      if (!add(0, value.length)) return undefined
      metrics.clonedTokenCodeUnits += value.length
      return value
    }
    if (value === null || value === undefined || typeof value === 'boolean' || typeof value === 'number') return value
    if (typeof value !== 'object' || depth > 256 || active.has(value)) { supported = false; return undefined }
    if (copies.has(value)) return copies.get(value)
    if (!add(1, 0)) return undefined
    const array = Array.isArray(value), prototype = Object.getPrototypeOf(value)
    if ((array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) || !Object.isExtensible(value)) {
      supported = false; return undefined
    }
    const length = array ? Object.getOwnPropertyDescriptor(value, 'length')! : undefined
    if (length && (!length.writable || !add(length.value, 0))) { supported = false; return undefined }
    const output = array ? new Array(length!.value) : Object.create(prototype)
    copies.set(value, output); active.add(value)
    metrics.clonedTokenNodes++
    for (const key of Reflect.ownKeys(value)) {
      if (array && key === 'length') continue
      if (typeof key !== 'string') { supported = false; break }
      if (!add(1, key.length)) break
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!
      if (!('value' in descriptor) || !descriptor.enumerable || !descriptor.writable || !descriptor.configurable) { supported = false; break }
      const child = copy(descriptor.value, depth + 1)
      if (!supported) break
      Object.defineProperty(output, key, { value: child, writable: true, enumerable: true, configurable: true })
    }
    active.delete(value)
    return output
  }
  const snapshot = copy(tokens, 0) as InlineToken[]
  return supported ? { tokens: snapshot, count, units } : undefined
}
