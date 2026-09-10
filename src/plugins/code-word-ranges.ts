import type { HighlightRange } from './highlight.js'
import { escape } from '../utils/escape.js'

const MAX_WORD_RANGES = 256

/** Resolve one-based code-point columns to half-open UTF-16 bounds in cleaned source. */
export function parseCodeWordRanges(source: string, value: string | true | undefined): { ranges: readonly HighlightRange[]; error?: string } {
  if (value === undefined) return { ranges: [] }
  if (typeof value !== 'string' || value.length > 16_384) return { ranges: [], error: 'mark must contain line and column ranges' }
  const parts = value.split(',')
  if (parts.length > MAX_WORD_RANGES) return { ranges: [], error: `mark exceeds ${MAX_WORD_RANGES} ranges` }
  const requests = new Map<number, Set<number>>()
  const positions: number[][] = []
  for (const part of parts) {
    const match = /^\s*(\d+):(\d+)\s*-\s*(\d+):(\d+)\s*$/.exec(part)
    if (!match) return { ranges: [], error: 'mark must use startLine:startColumn-endLine:endColumn' }
    const position = match.slice(1).map(Number)
    if (position.some(n => !Number.isSafeInteger(n) || n < 1)) return { ranges: [], error: 'mark positions must be positive safe integers' }
    positions.push(position)
    for (const [line, column] of [[position[0], position[1]], [position[2], position[3]]]) {
      if (!requests.has(line)) requests.set(line, new Set())
      requests.get(line)!.add(column)
    }
  }
  const offsets = new Map<number, Map<number, number>>()
  let line = 1
  let column = 1
  // Each source code point is visited once, independent of the number of ranges.
  for (let index = 0; index <= source.length;) {
    if (requests.get(line)?.has(column)) {
      if (!offsets.has(line)) offsets.set(line, new Map())
      offsets.get(line)!.set(column, index)
    }
    if (index === source.length) break
    if (source[index] === '\r' || source[index] === '\n') {
      index += source[index] === '\r' && source[index + 1] === '\n' ? 2 : 1
      line++; column = 1
    } else {
      index += source.codePointAt(index)! > 0xffff ? 2 : 1
      column++
    }
  }
  const ranges: { start: number; end: number }[] = []
  for (const [sl, sc, el, ec] of positions) {
    const start = offsets.get(sl)?.get(sc)
    const end = offsets.get(el)?.get(ec)
    if (start === undefined || end === undefined || start >= end) return { ranges: [], error: 'mark ranges must be nonempty and within the displayed source' }
    ranges.push({ start, end })
  }
  ranges.sort((a, b) => a.start - b.start || a.end - b.end)
  const merged: { start: number; end: number }[] = []
  for (const range of ranges) {
    const previous = merged[merged.length - 1]
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end)
    else merged.push(range)
  }
  return { ranges: Object.freeze(merged.map(range => Object.freeze(range))) }
}

/** Render a plain line using the same source ranges as the syntax renderer. */
export function renderCodeWordRanges(text: string, offset: number, ranges: readonly HighlightRange[], prefix: string): string {
  if (!ranges.length || !text.length) return escape(text)
  let low = 0, high = ranges.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (ranges[middle].end <= offset) low = middle + 1
    else high = middle
  }
  const parts: string[] = []
  let cursor = 0
  for (let index = low; index < ranges.length && ranges[index].start < offset + text.length; index++) {
    const from = Math.max(cursor, ranges[index].start - offset)
    const to = Math.min(text.length, ranges[index].end - offset)
    parts.push(escape(text.slice(cursor, from)), `<span class="${prefix}-word-highlight">${escape(text.slice(from, to))}</span>`)
    cursor = to
  }
  parts.push(escape(text.slice(cursor)))
  return parts.join('')
}
