import type { LazyLineSet } from '../core/types.js'

/**
 * Offsets of lazy continuation lines in a container's content, kept sorted
 * in a typed array: four bytes a line, where a Set holds tens. Each nesting
 * level keeps its own while the levels inside it are tokenized, so a deep
 * container of many short lines held one Set entry per line per level.
 */
export class LineSet implements LazyLineSet {
  private offsets: Int32Array
  private count = 0

  constructor(offsets: Iterable<number> = []) {
    this.offsets = new Int32Array(16)
    for (const offset of offsets) this.add(offset)
  }

  /** Adds an offset; containers add them in increasing order. */
  add(offset: number): void {
    const last = this.count > 0 ? this.offsets[this.count - 1]! : -1
    if (offset === last) return
    if (this.count === this.offsets.length) {
      const grown = new Int32Array(this.offsets.length * 2)
      grown.set(this.offsets)
      this.offsets = grown
    }
    if (offset > last) {
      this.offsets[this.count++] = offset
      return
    }
    const index = this.search(offset)
    if (this.offsets[index] === offset && index < this.count) return
    this.offsets.copyWithin(index + 1, index, this.count)
    this.offsets[index] = offset
    this.count++
  }

  get size(): number {
    return this.count
  }

  * [Symbol.iterator](): Iterator<number> {
    for (let index = 0; index < this.count; index++) yield this.offsets[index]!
  }

  has(offset: number): boolean {
    const index = this.search(offset)
    return index < this.count && this.offsets[index] === offset
  }

  /** The offsets below `limit`, in order. */
  below(limit: number): number[] {
    return Array.from(this.offsets.subarray(0, this.search(limit)))
  }

  /** The first index whose offset is at least `offset`. */
  private search(offset: number): number {
    let low = 0
    let high = this.count
    while (low < high) {
      const middle = (low + high) >>> 1
      if (this.offsets[middle]! < offset) low = middle + 1
      else high = middle
    }
    return low
  }
}
