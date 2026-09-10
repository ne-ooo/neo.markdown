/** A bounded HTML tag scanner shared by block and inline parsing. */
export function htmlTagEnd(source: string, start = 0): number {
  let index = start
  if (source[index++] !== '<') return -1
  const closing = source[index] === '/'
  if (closing) index++
  if (!/[a-z]/i.test(source[index] ?? '')) return -1
  index++
  while (/[a-z\d-]/i.test(source[index] ?? '')) index++
  while (index < source.length) {
    const before = index
    while (/[ \t\n\r]/.test(source[index] ?? '')) index++
    if (source[index] === '>') return index + 1
    if (!closing && source[index] === '/' && source[index + 1] === '>') return index + 2
    if (closing || before === index || !/[a-z_:]/i.test(source[index] ?? '')) return -1
    index++
    while (/[a-z\d_.:\-]/i.test(source[index] ?? '')) index++
    const nameEnd = index
    while (/[ \t\n\r]/.test(source[index] ?? '')) index++
    if (source[index] !== '=') { index = nameEnd; continue }
    index++
    while (/[ \t\n\r]/.test(source[index] ?? '')) index++
    const quote = source[index]
    if (quote === '"' || quote === "'") {
      const close = source.indexOf(quote, index + 1)
      if (close < 0) return -1
      index = close + 1
    } else {
      const startValue = index
      while (index < source.length && !/[\s"'=<>`]/.test(source[index])) index++
      if (startValue === index) return -1
    }
  }
  return -1
}

const BLOCK_TAG = /^ {0,3}<\/?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|source|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?=[ \t\n/>]|$)/i

export function htmlBlockStart(line: string): { close?: RegExp; interrupts: boolean } | null {
  const match = /^ {0,3}(.*)/.exec(line)!
  if (line.startsWith('    ') || line.startsWith('\t')) return null
  const text = match[1]
  if (/^<(?:script|pre|style|textarea)(?=[ \t>]|$)/i.test(text)) return { close: /<\/(?:script|pre|style|textarea)>/i, interrupts: true }
  if (text.startsWith('<!--')) return { close: /-->/, interrupts: true }
  if (text.startsWith('<?')) return { close: /\?>/, interrupts: true }
  if (/^<![A-Z]/.test(text)) return { close: />/, interrupts: true }
  if (text.startsWith('<![CDATA[')) return { close: /\]\]>/, interrupts: true }
  if (BLOCK_TAG.test(line)) return { interrupts: true }
  const end = htmlTagEnd(text)
  return end >= 0 && /^[ \t]*$/.test(text.slice(end)) ? { interrupts: false } : null
}
