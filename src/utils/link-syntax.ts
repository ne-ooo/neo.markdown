export function scanDestination(source: string, start: number, observe?: (end: number) => void): { end: number; value: string } | null {
  let index = start
  try {
    if (source[index] === '<') {
      index++
      while (index < source.length) {
        if (source[index] === '\\' && /[\\<>]/.test(source[index + 1] ?? '')) { index += 2; continue }
        if (source[index] === '>') return { end: index + 1, value: source.slice(start + 1, index) }
        if (source[index] === '<' || source[index] === '\n') return null
        index++
      }
      return null
    }
    let depth = 0
    while (index < source.length) {
      const char = source[index]
      if (/[\x00-\x20\x7f]/.test(char)) break
      if (char === '\\' && /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/.test(source[index + 1] ?? '')) { index += 2; continue }
      if (char === '(') { if (++depth > 32) return null }
      else if (char === ')') { if (depth === 0) break; depth-- }
      index++
    }
    return depth === 0 && index > start ? { end: index, value: source.slice(start, index) } : null
  } finally { observe?.(Math.min(source.length + 1, index + 2)) }
}

export function scanTitle(source: string, start: number, observe?: (end: number) => void): { end: number; value: string } | null {
  let index = start
  try {
    const quote = source[start]
    if (quote !== '"' && quote !== "'" && quote !== '(') return null
    const close = quote === '(' ? ')' : quote
    index = start + 1
    while (index < source.length) {
      if (source[index] === '\\' && /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/.test(source[index + 1] ?? '')) { index += 2; continue }
      if (source[index] === close) return { end: index + 1, value: source.slice(start + 1, index) }
      if (quote === '(' && source[index] === '(') return null
      if (source[index] === '\n') {
        if (observe) observe(index + 2 + /^[ \t]*/.exec(source.slice(index + 1))![0].length)
        if (/^[ \t]*\n/.test(source.slice(index + 1))) return null
      }
      index++
    }
    return null
  } finally { observe?.(Math.min(source.length + 1, index + 2)) }
}
