/** Per-session guards and dependency readers. This object never retains registration builders. */
export class PluginRuntime {
  enabled = false
  hasInlineRules = false
  cacheableInline = true
  private phase = 0
  private readers: Array<() => string> = []

  constructor(private readonly fail: (message: string) => never, private readonly checkOpen: () => void) {}

  addRevision(read: () => string): void { this.readers.push(read) }
  dispose(): void { this.readers = [] }

  observeResult(result: unknown): void {
    if (result === null) return
    if (!result || typeof result !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(result))) {
      this.cacheableInline = false; return
    }
    for (const key of ['raw', 'token']) {
      const descriptor = Object.getOwnPropertyDescriptor(result, key)
      if (!descriptor || !('value' in descriptor)) this.cacheableInline = false
    }
  }

  guardService(): void {
    if (this.enabled && this.phase) this.fail('Incremental inline callbacks cannot use rendering or document services')
  }

  guarded<T>(callback: () => T): T {
    if (!this.enabled) return callback()
    this.phase++
    try {
      const result = callback()
      // A callback can catch an immediate phase, registration, or reentrancy error.
      this.checkOpen()
      return result
    } finally { this.phase-- }
  }

  revisions(charge: (units: number) => void): string[] {
    if (!this.enabled) return []
    const revisions: string[] = []
    let units = 0
    for (const read of this.readers) {
      charge(1)
      const value = this.guarded(read)
      if (typeof value !== 'string') throw new TypeError('Incremental plugin revision must be a string')
      if (value.length > 1024 || value.length > 65_536 - units) throw new RangeError('Incremental plugin revision exceeds its length limit')
      charge(value.length)
      units += value.length
      revisions.push(value)
    }
    return revisions
  }
}
