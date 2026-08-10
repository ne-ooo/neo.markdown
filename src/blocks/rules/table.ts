import type { BlockRule, TableCell } from '../../core/types.js'

const TABLE = /^ {0,3}((?=\S)(?=[^\n]*\|)[^\n]+)\n {0,3}((?=[ :|-]*\|)[ :|-]+)\n((?:(?=[^\n]*\|)[^\n]*(?:\n|$))*)/

function splitRow(line: string): string[] {
  let value = line.trim()
  if (value.startsWith('|')) value = value.slice(1)
  if (value.endsWith('|')) {
    let backslashes = 0
    for (let index = value.length - 2; index >= 0 && value[index] === '\\'; index--) {
      backslashes++
    }
    if (backslashes % 2 === 0) value = value.slice(0, -1)
  }

  const cells: string[] = []
  let cell = ''
  for (let index = 0; index < value.length; index++) {
    if (value[index] === '\\' && value[index + 1] === '|') {
      cell += '|'
      index++
    } else if (value[index] === '|') {
      cells.push(cell)
      cell = ''
    } else {
      cell += value[index]
    }
  }
  cells.push(cell)
  return cells
}

function parseRow(line: string): TableCell[] {
  return splitRow(line).map((text) => ({ text: text.trim(), tokens: [] }))
}

function parseAlignment(line: string): Array<'left' | 'center' | 'right' | null> {
  const delimiters = splitRow(line).map((delimiter) => delimiter.trim())
  if (delimiters.length === 0 || delimiters.some((delimiter) => !/^:?-+:?$/.test(delimiter))) {
    return []
  }
  return delimiters.map((delimiter) => {
    const left = delimiter.startsWith(':')
    const right = delimiter.endsWith(':')
    if (left && right) return 'center'
    if (right) return 'right'
    if (left) return 'left'
    return null
  })
}

/** GFM table rule. */
export const table: BlockRule = {
  name: 'table',
  priority: 700,
  starts: (src, options) => options.gfm === true && TABLE.test(src),
  tokenize(src, options) {
    if (options.gfm !== true) return null
    const match = TABLE.exec(src)
    if (!match) return null

    const raw = match[0]
    const align = parseAlignment(match[2])
    if (align.length === 0) return null
    const header = parseRow(match[1])
    if (header.length !== align.length) return null

    const rows: TableCell[][] = []
    if (match[3].trim()) {
      for (const line of match[3].trim().split('\n')) {
        if (!line.includes('|')) continue
        const cells = parseRow(line)
        while (cells.length < align.length) cells.push({ text: '', tokens: [] })
        if (cells.length > align.length) cells.splice(align.length)
        rows.push(cells)
      }
    }

    return { token: { type: 'table', raw, header, align, rows }, raw }
  },
}
