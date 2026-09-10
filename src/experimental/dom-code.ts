import { captureCodeEntries, type CodeEntries } from './dom-code-entries.js'
import { bindCodeShell, codeLeaves, codeRanges, prepareCodeShell, sameCodeShell, type CodeLimits, type CodeRange } from './dom-code-shell.js'
import { patchTree, type DomTree } from './dom-tree.js'

interface CodeBlock extends CodeEntries { key: string; code: HTMLElement; range: CodeRange; depth: number }
interface Snapshot { html: string; blocks: CodeBlock[]; tree: DomTree; shellNodes: number; shellUnits: number }
interface Plan { block: CodeBlock; change?: { first: number; last: number; source: CodeBlock; code: HTMLElement } }
interface CodePatch { mode: 'patch' | 'unchanged' | 'invalidated'; reusedRegions: number; removedRegions: number; insertedRegions: number; patchedRegions?: number }

/** Code syntax and surrounding containers have separate bounded snapshots. */
export function createCodeBlockPatcher(root: HTMLElement, limits: CodeLimits, patchChildren: boolean) {
  let snapshot: Snapshot | undefined, rejected: string | undefined, changed = false, identity = 0
  const Observer = root.ownerDocument.defaultView?.MutationObserver
  const ownedMutation = (record: MutationRecord) => record.type !== 'attributes' || record.target !== root
  const observer = Observer ? new Observer(records => { if (records.some(ownedMutation)) changed = true }) : undefined
  observer?.observe(root, { childList: true, subtree: true, attributes: true, characterData: true })
  const reset = () => { snapshot = undefined }
  function ranges(html: string) {
    return observer && html.length <= limits.maxHtml ? codeRanges(html, Math.floor(limits.maxNodes / 2)) : undefined
  }
  function pair(old: Snapshot, html: string, ranges: CodeRange[]) {
    const paired: Array<CodeBlock | undefined> = Array(ranges.length).fill(undefined), used = new Set<CodeBlock>()
    const equal = (block: CodeBlock, range: CodeRange) => block.range.open === range.open
      && old.html.slice(block.range.start, block.range.end) === html.slice(range.start, range.end)
    let prefix = 0, suffix = 0
    while (prefix < old.blocks.length && prefix < ranges.length && equal(old.blocks[prefix], ranges[prefix])) {
      paired[prefix] = old.blocks[prefix]; used.add(old.blocks[prefix++])
    }
    while (suffix < old.blocks.length - prefix && suffix < ranges.length - prefix
      && equal(old.blocks[old.blocks.length - suffix - 1], ranges[ranges.length - suffix - 1])) {
      const block = old.blocks[old.blocks.length - ++suffix]
      paired[ranges.length - suffix] = block; used.add(block)
    }
    const remaining = old.blocks.slice(prefix, old.blocks.length - suffix)
    if (remaining.length === 1 && ranges.length - prefix - suffix === 1) {
      if (remaining[0].range.open === ranges[prefix].open) paired[prefix] = remaining[0]
      return paired
    }
    const candidates = new Map<string, { blocks: CodeBlock[]; next: number }>()
    const key = (text: string, range: CodeRange) => range.open + '\0' + text.slice(range.start, range.end)
    for (const block of remaining) {
      const value = key(old.html, block.range), queue = candidates.get(value)
      if (queue) queue.blocks.push(block)
      else candidates.set(value, { blocks: [block], next: 0 })
    }
    for (let i = prefix; i < ranges.length - suffix; i++) {
      const queue = candidates.get(key(html, ranges[i])), block = queue?.blocks[queue.next]
      if (block) { queue!.next++; paired[i] = block; used.add(block) }
    }
    let at = 0
    for (let i = prefix; i < ranges.length - suffix; i++) {
      if (paired[i]) continue
      while (at < remaining.length && used.has(remaining[at])) at++
      const block = remaining[at++]
      if (block?.range.open === ranges[i].open) { paired[i] = block; used.add(block) }
    }
    return paired
  }
  function prepareBlock(html: string, range: CodeRange, key: string, depth: number, budget: number, old?: Snapshot, source?: CodeBlock, knownChanged = false): Plan | undefined {
    const length = range.end - range.start, previousLength = source ? source.range.end - source.range.start : 0
    if (source && !knownChanged && old!.html.slice(source.range.start, source.range.end) === html.slice(range.start, range.end)) {
      if (source.nodes > budget || depth + source.height > limits.maxDepth) return undefined
      return { block: { ...source, range, depth } }
    }
    let prefix = 0, suffix = 0, first = 0, last = source?.entries.length ?? 0, keptNodes = 0, keptHeight = 0
    if (source) {
      const common = Math.min(previousLength, length), before = old!.html
      const oldStart = source.range.start, oldEnd = source.range.end, start = range.start, end = range.end
      // Compare bounded slices natively, then inspect only the boundary characters.
      // The slices do not overlap, so both scans remain linear in the code length.
      const chunk = 1_024
      while (prefix + chunk <= common && html.startsWith(before.slice(oldStart + prefix, oldStart + prefix + chunk), start + prefix)) prefix += chunk
      while (prefix < common && before.charCodeAt(oldStart + prefix) === html.charCodeAt(start + prefix)) prefix++
      while (suffix + chunk <= common - prefix && html.startsWith(before.slice(oldEnd - suffix - chunk, oldEnd - suffix), end - suffix - chunk)) suffix += chunk
      while (suffix < common - prefix && before.charCodeAt(oldEnd - suffix - 1) === html.charCodeAt(end - suffix - 1)) suffix++
      while (first < last && source.entries[first].end <= prefix) {
        const entry = source.entries[first++]; keptNodes += entry.nodes; keptHeight = Math.max(keptHeight, entry.height)
      }
      while (last > first && source.entries[last - 1].start >= previousLength - suffix) {
        const entry = source.entries[--last]; keptNodes += entry.nodes; keptHeight = Math.max(keptHeight, entry.height)
      }
    }
    if (keptNodes > budget || keptHeight + depth > limits.maxDepth) return undefined
    const from = source?.entries[first]?.start ?? previousLength
    const to = length - (previousLength - (source?.entries[last]?.start ?? previousLength))
    const template = root.ownerDocument.createElement('template')
    template.innerHTML = range.open + html.slice(range.start + from, range.start + to) + '</code>'
    const code = template.content.firstChild as HTMLElement | null
    if (template.content.childNodes.length !== 1 || code?.nodeType !== 1 || code.localName !== 'code') return undefined
    const fresh = captureCodeEntries(code, html, range.start + from, range.start + to, range.start, budget - keptNodes, limits.maxDepth - depth)
    if (!fresh) return undefined
    const shift = length - previousLength
    const entries = source ? [...source.entries.slice(0, first), ...fresh.entries,
      ...source.entries.slice(last).map(entry => shift ? { ...entry, start: entry.start + shift, end: entry.end + shift } : entry)] : fresh.entries
    const block = { key, code: source?.code ?? code, range, depth, entries, nodes: keptNodes + fresh.nodes, height: Math.max(keptHeight, fresh.height) }
    return { block, ...(source ? { change: { first, last, source, code } } : {}) }
  }
  function capture(html: string) {
    reset(); observer?.takeRecords(); changed = false
    const skip = rejected === html; rejected = undefined
    if (skip) return
    const next = ranges(html)
    if (!next) return
    identity = 0
    const keys = next.map(() => String(++identity))
    const shell = prepareCodeShell(root.ownerDocument, html, next, keys, limits)
    if (!shell || !bindCodeShell(shell.tree, root)) return
    const leaves = codeLeaves(shell.tree), blocks: CodeBlock[] = []
    let nodes = shell.nodes
    for (let i = 0; i < next.length; i++) {
      const range = next[i], code = leaves.get(keys[i])!.node as HTMLElement, depth = shell.depths[i]
      const captured = captureCodeEntries(code, html, range.start, range.end, range.start, limits.maxNodes - nodes, limits.maxDepth - depth)
      if (!captured) return
      nodes += captured.nodes
      blocks.push({ ...captured, key: keys[i], code, range, depth })
    }
    snapshot = { html, blocks, tree: shell.tree, shellNodes: shell.nodes, shellUnits: shell.units }
  }
  return {
    capture,
    reset,
    patch(html: string): CodePatch | undefined {
      const old = snapshot
      if (!old) return undefined
      if (changed || observer!.takeRecords().some(ownedMutation)) { reset(); return { mode: 'invalidated', reusedRegions: 0, removedRegions: 0, insertedRegions: 0 } }
      if (old.html === html) return { mode: 'unchanged', reusedRegions: old.tree.children.length, removedRegions: 0, insertedRegions: 0 }
      const decline = () => { rejected = html; return undefined }
      if (html.length > limits.maxHtml) return decline()
      // A stable single block needs only its known envelope, not another full block search.
      // Check the first closing boundary so a newly appended block still uses multi-block matching.
      let next: CodeRange[] | undefined, sameShell = false
      if (old.blocks.length === 1) {
        const range = old.blocks[0].range, tail = old.html.slice(range.end), end = html.length - tail.length
        if (end >= range.start && html.startsWith(old.html.slice(0, range.start)) && html.endsWith(tail)
          && html.indexOf('</code></pre>', range.start) === end) {
          next = [{ ...range, end }]; sameShell = true
        }
      }
      next ??= ranges(html)
      if (!next || identity > Number.MAX_SAFE_INTEGER - next.length) return decline()
      sameShell ||= sameCodeShell(old.html, old.blocks.map(block => block.range), html, next)
      const paired = sameShell && next.length === 1 ? old.blocks : pair(old, html, next)
      const stable = sameShell && paired.every((block, i) => block === old.blocks[i])
      const keys = paired.map(block => block?.key ?? String(++identity))
      const shell = stable ? undefined : prepareCodeShell(root.ownerDocument, html, next, keys, limits)
      if (!stable && !shell) return decline()
      const shellNodes = shell?.nodes ?? old.shellNodes, shellUnits = shell?.units ?? old.shellUnits
      if (html.length + shellUnits > limits.maxHtml) return decline()
      const plans: Plan[] = []
      let nodes = shellNodes
      for (let i = 0; i < next.length; i++) {
        const plan = prepareBlock(html, next[i], keys[i], shell?.depths[i] ?? old.blocks[i].depth, limits.maxNodes - nodes, old, paired[i], stable && next.length === 1)
        if (!plan) return decline()
        plans.push(plan); nodes += plan.block.nodes
      }
      // Every shell and syntax change passes its limits before live DOM mutation starts.
      const tree = shell ? patchTree(old.tree, shell.tree, patchChildren) : old.tree
      const leaves = codeLeaves(tree)
      const changedCode = new Set(plans.filter(plan => plan.change).map(plan => plan.block.key))
      for (const { block, change } of plans) {
        const leaf = leaves.get(block.key)!
        if (leaf.node !== block.code) {
          leaf.node.parentNode!.replaceChild(block.code, leaf.node)
          leaf.node = block.code
        }
        if (change) {
          const { source, first, last, code } = change, anchor = source.entries[last]?.node ?? null
          const fragment = root.ownerDocument.createDocumentFragment()
          while (code.firstChild) fragment.appendChild(code.firstChild)
          for (let i = first; i < last; i++) block.code.removeChild(source.entries[i].node)
          block.code.insertBefore(fragment, anchor)
        }
      }
      const previous = new Map(old.tree.children.map(child => [child.node, child]))
      let reusedRegions = 0, patchedRegions = 0, insertedRegions = 0
      for (const child of tree.children) {
        if (!previous.has(child.node)) { insertedRegions++; continue }
        const syntaxChanged = Array.from(codeLeaves(child).keys()).some(key => changedCode.has(key))
        if (previous.get(child.node) === child && !syntaxChanged) reusedRegions++
        else patchedRegions++
        previous.delete(child.node)
      }
      snapshot = { html, tree, shellNodes, shellUnits, blocks: plans.map(plan => plan.block) }
      observer!.takeRecords(); changed = false; rejected = undefined
      return { mode: 'patch', reusedRegions, ...(patchedRegions ? { patchedRegions } : {}), removedRegions: previous.size, insertedRegions }
    },
    dispose() { observer?.disconnect(); reset(); rejected = undefined },
    get metrics() { return { cachedCodeBlockHtmlCodeUnits: snapshot?.html.length ?? 0,
      cachedCodeBlockNodes: snapshot?.blocks.reduce((sum, block) => sum + block.nodes + 2, 0) ?? 0 } },
  }
}
