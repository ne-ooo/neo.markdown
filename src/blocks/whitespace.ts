/** Markdown indentation uses four-column tab stops. */
export function indentation(line: string, column = 0): number {
  const start = column
  for (const char of line) {
    if (char === ' ') column++
    else if (char === '\t') column += 4 - column % 4
    else break
  }
  return column - start
}

/** Remove indentation, preserving the unused part of a tab as spaces. */
export function stripIndent(line: string, count: number, column = 0): string {
  let index = 0
  const target = column + count
  while (column < target && index < line.length) {
    const char = line[index]
    if (char !== ' ' && char !== '\t') break
    column += char === '\t' ? 4 - column % 4 : 1
    index++
  }
  if (target % 4 !== 0) {
    while (line[index] === ' ' || line[index] === '\t') {
      column += line[index++] === '\t' ? 4 - column % 4 : 1
    }
  }
  return ' '.repeat(Math.max(0, column - target)) + line.slice(index)
}
