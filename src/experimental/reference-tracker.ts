import type { LinkReference } from '../core/types.js'

/** Track successful and unresolved lookups. Complete-map reads use the document fingerprint instead. */
export class ReferenceTracker implements ReadonlyMap<string, LinkReference> {
  readonly dependencies = new Map<string, LinkReference | undefined>()
  units = 0
  cacheable = true
  wholeMapRead = false

  constructor(private readonly source: ReadonlyMap<string, LinkReference>, private readonly maxEntries: number,
    private readonly maxUnits: number, private readonly charge: (units: number) => void) {}

  get(label: string): LinkReference | undefined {
    const value = this.source.get(label)
    if (this.cacheable && !this.dependencies.has(label)) {
      const units = label.length + (value?.href.length ?? 0) + (value?.title?.length ?? 0)
      this.charge(units + 1)
      if (this.dependencies.size >= this.maxEntries || units > this.maxUnits - this.units) {
        this.cacheable = false; this.dependencies.clear(); this.units = 0
      } else { this.dependencies.set(label, value); this.units += units }
    }
    return value
  }

  has(label: string): boolean { return this.get(label) !== undefined }
  get size(): number { this.wholeMapRead = true; return this.source.size }
  entries(): MapIterator<[string, LinkReference]> { this.wholeMapRead = true; return this.source.entries() }
  keys(): MapIterator<string> { this.wholeMapRead = true; return this.source.keys() }
  values(): MapIterator<LinkReference> { this.wholeMapRead = true; return this.source.values() }
  [Symbol.iterator](): MapIterator<[string, LinkReference]> { return this.entries() }
  forEach(callback: (value: LinkReference, key: string, map: ReadonlyMap<string, LinkReference>) => void, thisArg?: unknown): void {
    this.wholeMapRead = true
    this.source.forEach((value, key) => callback.call(thisArg, value, key, this))
  }
}
