export interface CodeEntry { node: Node; start: number; end: number; nodes: number; height: number }
export interface CodeEntries { entries: CodeEntry[]; nodes: number; height: number }

/** Match syntax nodes to source offsets without serializing an entire code block. */
export function captureCodeEntries(parent: HTMLElement, html: string, from: number, to: number, base: number, budget: number, maxHeight: number): CodeEntries | undefined {
  const entries: CodeEntry[] = []
  let offset = from, count = 0, scheduled = 0, height = 0
  function match(text: string) {
    if (offset + text.length > to || !html.startsWith(text, offset)) return false
    offset += text.length
    return true
  }
  for (const node of parent.childNodes) {
    const start = offset - base, before = count
    let entryHeight = 0
    const stack: Array<{ node: Node; depth: number; close?: boolean }> = [{ node, depth: 1 }]
    if (++scheduled > budget) return undefined
    while (stack.length) {
      const item = stack.pop()!
      if (item.close) { if (!match('</span>')) return undefined; continue }
      count++; entryHeight = Math.max(entryHeight, item.depth)
      if (item.depth > maxHeight) return undefined
      if (item.node.nodeType === 1) {
        const element = item.node as Element
        if (element.namespaceURI !== 'http://www.w3.org/1999/xhtml' || element.localName !== 'span' || element.hasAttribute('is')) return undefined
        for (const name of element.getAttributeNames()) if (/^on/i.test(name)) return undefined
        if (!match((element.cloneNode(false) as Element).outerHTML.slice(0, -7))) return undefined
        stack.push({ node: element, depth: item.depth, close: true })
        for (let child = element.lastChild; child; child = child.previousSibling) {
          if (++scheduled > budget) return undefined
          stack.push({ node: child, depth: item.depth + 1 })
        }
      } else if (item.node.nodeType === 3) {
        const text = item.node.nodeValue!.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        // Neo and browser serialization use different, equivalent quote escapes in text.
        if (!match(text) && !match(text.replace(/"/g, '&quot;').replace(/'/g, '&#39;'))) return undefined
      } else return undefined
    }
    height = Math.max(height, entryHeight)
    entries.push({ node, start, end: offset - base, nodes: count - before, height: entryHeight })
  }
  return offset === to ? { entries, nodes: count, height } : undefined
}
