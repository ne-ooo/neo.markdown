import { patchableElement } from './dom-policy.js'
import { captureTree, type DomTree } from './dom-tree.js'
export interface CodeRange { pre: number; start: number; end: number; open: string }
export interface CodeLimits { maxHtml: number; maxNodes: number; maxDepth: number; maxRegions: number }
export interface CodeShell { tree: DomTree; codes: HTMLElement[]; depths: number[]; units: number; nodes: number }

export function codeRanges(html: string, maxBlocks: number): CodeRange[] | undefined {
  const ranges: CodeRange[] = []
  let cursor = 0
  for (;;) {
    const pre = html.indexOf('<pre', cursor)
    if (pre < 0) return ranges.length ? ranges : undefined
    if (ranges.length >= maxBlocks) return undefined
    const opening = /^(<pre(?:\s[^<>]*)?>)(<code(?:\s[^<>]*)?>)/.exec(html.slice(pre))
    if (!opening) return undefined
    const start = pre + opening[0].length, end = html.indexOf('</code></pre>', start)
    if (end < 0 || html.indexOf('<pre', start) >= 0 && html.indexOf('<pre', start) < end) return undefined
    ranges.push({ pre, start, end, open: opening[2] })
    cursor = end + 13
  }
}

export function sameCodeShell(before: string, old: CodeRange[], html: string, next: CodeRange[]): boolean {
  if (old.length !== next.length) return false
  let left = 0, right = 0
  for (let i = 0; i < old.length; i++) {
    if (before.slice(left, old[i].start) !== html.slice(right, next[i].start)) return false
    left = old[i].end; right = next[i].end
  }
  return before.slice(left) === html.slice(right)
}

/** Parse the surrounding structure with empty code leaves in an inert document. */
export function prepareCodeShell(document: Document, html: string, ranges: CodeRange[], keys: string[], limits: CodeLimits): CodeShell | undefined {
  let cursor = 0
  const pieces: string[] = []
  for (const range of ranges) { pieces.push(html.slice(cursor, range.start)); cursor = range.end }
  pieces.push(html.slice(cursor))
  const template = document.createElement('template')
  template.innerHTML = pieces.join('')
  const wrapper = template.content.ownerDocument.createElement('div')
  wrapper.appendChild(template.content)
  if (wrapper.childNodes.length > limits.maxRegions) return undefined
  const codes: HTMLElement[] = [], depths: number[] = []
  let nodes = 0, scheduled = 0
  const stack: Array<{ node: Node; depth: number }> = []
  for (let node = wrapper.lastChild; node; node = node.previousSibling) {
    if (++scheduled > limits.maxNodes) return undefined
    stack.push({ node, depth: 1 })
  }
  while (stack.length) {
    const { node, depth } = stack.pop()!
    nodes++
    if (depth > limits.maxDepth) return undefined
    if (node.nodeType === 1) {
      const tag = node as HTMLElement
      if (!patchableElement(tag, depth)) return undefined
      if (tag.localName === 'pre') {
        const code = tag.firstChild as HTMLElement | null, range = ranges[codes.length]
        if (!range || tag.childNodes.length !== 1 || code?.nodeType !== 1 || code.localName !== 'code' || code.childNodes.length) return undefined
        if (tag.outerHTML !== html.slice(range.pre, range.start) + '</code></pre>') return undefined
        codes.push(code); depths.push(depth + 1)
      }
      for (let child = node.lastChild; child; child = child.previousSibling) {
        if (++scheduled > limits.maxNodes) return undefined
        stack.push({ node: child, depth: depth + 1 })
      }
    } else if (node.nodeType !== 3 && node.nodeType !== 8) return undefined
  }
  if (codes.length !== ranges.length) return undefined
  const tree = captureTree(wrapper, limits.maxHtml - html.length, new Map(codes.map((node, i) => [node, keys[i]])))
  if (!tree || tree.blocked) return undefined
  return { tree, codes, depths, nodes, units: tree.units }
}

/** Bind a bounded empty-code tree to the already installed, browser-normalized document. */
export function bindCodeShell(tree: DomTree, root: HTMLElement): boolean {
  const stack: Array<{ tree: DomTree; node: Node; root?: boolean }> = [{ tree, node: root, root: true }]
  while (stack.length) {
    const { tree, node, root } = stack.pop()!
    if (tree.node.nodeType !== node.nodeType) return false
    if (!root) {
      if (node.nodeType === 1) {
        const element = node as Element
        if (element.namespaceURI !== 'http://www.w3.org/1999/xhtml' || element.localName !== tree.tag) return false
        const own = JSON.stringify(element.getAttributeNames().map(name => [name, element.getAttribute(name)!]))
        if (own !== tree.own.split('\0')[0]) return false
      } else if (node.nodeValue !== tree.node.nodeValue) return false
    }
    tree.node = node
    if (tree.tag === 'code' && tree.own.includes('\0')) continue
    if (node.childNodes.length !== tree.children.length) return false
    for (let i = 0; i < tree.children.length; i++) stack.push({ tree: tree.children[i], node: node.childNodes[i] })
  }
  return true
}

export function codeLeaves(tree: DomTree): Map<string, DomTree> {
  const leaves = new Map<string, DomTree>(), stack = [tree]
  while (stack.length) {
    const current = stack.pop()!, at = current.own.lastIndexOf('\0')
    if (current.tag === 'code' && at >= 0) leaves.set(current.own.slice(at + 1), current)
    else for (const child of current.children) stack.push(child)
  }
  return leaves
}
