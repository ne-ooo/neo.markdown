import { dependOnLine } from '../dependencies.js'
import type { BlockRule, BlockRuleContext, TableCell } from '../../core/types.js'

const TABLE = /^ {0,3}((?=\S)(?=[^\n]*\|)[^\n]+)\n {0,3}((?=[ :|-]*\|)[ :|-]+)(?:\n|$)/
interface TableState {
  kind: 'table'; cursor: number; cost: number; header: TableCell[]
  align: Array<'left' | 'center' | 'right' | null>; rows: TableCell[][]
}

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

function parseRow(line: string, context?: BlockRuleContext): TableCell[] {
  const values = splitRow(line)
  context?.consumeTokens(values.length)
  return values.map((text) => ({ text: text.trim(), tokens: [] }))
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
  tokenize(src, options, context) {
    if (options.gfm !== true) return null
    const match = TABLE.exec(src)
    if (!match) return null

    const continuation = context?.continuation
    const previous = continuation?.previous as TableState | undefined
    const saved = previous?.kind === 'table' ? previous : undefined
    const initialBudget = continuation?.budget() ?? 0
    const align = saved?.align ?? parseAlignment(match[2])
    if (align.length === 0) return null
    const header = saved?.header ?? parseRow(match[1], context)
    if (header.length !== align.length) return null
    if (saved) { context!.consumeTokens(saved.cost); continuation!.reused(saved.cursor) }

    const rows: TableCell[][] = saved?.rows.slice() ?? []
    let cursor = saved?.cursor ?? match[0].length
    while (cursor < src.length) {
      dependOnLine(src, cursor, context)
      const newline = src.indexOf('\n', cursor)
      const end = newline < 0 ? src.length : newline
      const line = src.slice(cursor, end)
      if (/^[ \t]*$/.test(line) || context?.interruptsParagraph(src.slice(cursor), 100, 'table')) break
      const cells = parseRow(line, context)
      if (cells.length < align.length) context?.consumeTokens(align.length - cells.length)
      while (cells.length < align.length) cells.push({ text: '', tokens: [] })
      if (cells.length > align.length) cells.splice(align.length)
      rows.push(cells)
      cursor = newline < 0 ? end : end + 1
      if (continuation) {
        const end = cursor, count = rows.length, cost = initialBudget - continuation.budget()
        continuation.retain(() => ({ kind: 'table', cursor: end, header, align, rows: rows.slice(0, count), cost } satisfies TableState))
      }
    }
    const raw = src.slice(0, cursor)

    return { token: { type: 'table', raw, header, align, rows }, raw }
  },
}
