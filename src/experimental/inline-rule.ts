import type { InlineRule } from '../core/types.js'

/** Snapshot documented setup data without calling property getters. Unsupported metadata keeps ordinary parsing. */
export function snapshotInlineRule(input: InlineRule, available: number): { rule: InlineRule; units: number } | 'invalid' | 'limit' {
  if (!input || typeof input !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) return 'invalid'
  const names = ['name', 'priority', 'triggerChars', 'tokenize']
  if (Reflect.ownKeys(input).some(key => typeof key !== 'string' || !names.includes(key))) return 'invalid'
  const values: Record<string, unknown> = {}
  for (const name of names) {
    const descriptor = Object.getOwnPropertyDescriptor(input, name)
    if (descriptor && !('value' in descriptor)) return 'invalid'
    values[name] = descriptor?.value
  }
  const { name, priority, tokenize } = values
  if (typeof name !== 'string' || typeof tokenize !== 'function'
    || (priority !== undefined && typeof priority !== 'string' && typeof priority !== 'number')) return 'invalid'
  let units = 1 + name.length + (typeof priority === 'string' ? priority.length : 0)
  if (units > available) return 'limit'
  let triggerChars: number[] | undefined
  if (values.triggerChars !== undefined) {
    const chars = values.triggerChars
    if (!Array.isArray(chars) || Object.getPrototypeOf(chars) !== Array.prototype) return 'invalid'
    if (chars.length > available - units) return 'limit'
    units += chars.length
    if (Reflect.ownKeys(chars).length !== chars.length + 1) return 'invalid'
    triggerChars = []
    for (let i = 0; i < chars.length; i++) {
      const descriptor = Object.getOwnPropertyDescriptor(chars, String(i))
      const value = descriptor && 'value' in descriptor ? descriptor.value : undefined
      if (!Number.isInteger(value) || value < 0 || value > 65535) return 'invalid'
      triggerChars.push(value)
    }
    Object.freeze(triggerChars)
  }
  return { rule: Object.freeze({ name, priority, triggerChars, tokenize }) as InlineRule, units }
}
