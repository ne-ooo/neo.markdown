import { indentation, stripIndent } from './whitespace.js'

export function listMarker(line: string) {
  const match = /^( {0,3})([*+-]|\d{1,9}[.)])(?=[ \t\n]|$)/.exec(line)
  if (!match) return null
  const column = match[0].length
  const rest = line.slice(column)
  const spaces = indentation(rest, column)
  const padding = /^[ \t]*$/.test(rest) || spaces > 4 ? 1 : spaces
  return {
    indent: match[1].length,
    marker: match[2],
    ordered: match[2].length > 1,
    contentIndent: column + padding,
    text: stripIndent(rest, padding, column),
  }
}

/** Track whether a container's current leaf can accept a lazy paragraph line. */
export class ParagraphState {
  open = false
  private fence: string | undefined
  constructor(previous?: { open: boolean; fence?: string }) {
    if (previous) { this.open = previous.open; this.fence = previous.fence }
  }
  snapshot(): { open: boolean; fence?: string } { return { open: this.open, fence: this.fence } }
  feed(input: string): void {
    let line = input
    // Prefix removal is iterative and bounded by the source length.
    while (true) {
      const quote = /^( {0,3})>/.exec(line)
      if (quote) { line = stripIndent(line.slice(quote[0].length), 1, quote[0].length); continue }
      const marker = listMarker(line)
      if (marker) { line = marker.text; continue }
      break
    }
    if (this.fence) {
      const close = /^ {0,3}(`+|~+)[ \t]*$/.exec(line)
      if (close && close[1][0] === this.fence[0] && close[1].length >= this.fence.length) this.fence = undefined
      this.open = false
      return
    }
    const fence = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line)
    if (fence && !(fence[1][0] === '`' && fence[2].includes('`'))) {
      this.fence = fence[1]; this.open = false; return
    }
    if (/^[ \t]*$/.test(line) || /^ {0,3}(?:#{1,6}(?:[ \t]|$)|(?:\*[ \t]*){3,}$|(?:_[ \t]*){3,}$|(?:-[ \t]*){3,}$)/.test(line)) {
      this.open = false; return
    }
    if (this.open && /^ {0,3}(?:=+|-+)[ \t]*$/.test(line)) { this.open = false; return }
    if (!this.open && indentation(line) >= 4) return
    this.open = true
  }
}
