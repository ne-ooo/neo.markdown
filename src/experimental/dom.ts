import { patchableElement } from './dom-policy.js'
import { createCodeBlockPatcher } from './dom-code.js'
import { captureTree, canPatchTree, ownsTree, patchTree, type DomTree } from './dom-tree.js'

const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml'

export interface MarkdownViewOptions {
  /** Opt into bounded code-block and surrounding-container staging. Requires no initializer. Zero (default) disables this cache. */
  maxCodeBlockHtmlLength?: number
  /** Initialize a region after insertion into the root. Cleanup must release listeners and pending work. */
  initialize?: (region: HTMLElement) => (() => void) | MarkdownViewLifecycle | void
  /** Patch ordinary descendants. Initialized regions also require an explicit lifecycle update hook. Default: true. */
  patchChildren?: boolean
  /** Maximum input and serialized snapshot units retained for patching. Larger output uses replacement. */
  maxCachedHtmlLength?: number
  /** Maximum canonical nodes per update, including reused regions. Larger documents use replacement. */
  maxNodes?: number
  /** Maximum retained top-level regions, including text and comments. */
  maxRegions?: number
  /** Maximum inspected nesting depth. */
  maxDepth?: number
}
export interface MarkdownViewLifecycle {
  /** Release this scope when its region is removed or the view closes. */
  dispose: () => void
  /** Opt into descendant patches. Reconcile scoped listeners and transient state after each patch. */
  update: () => void
}
export type MarkdownViewFallback = 'html-limit' | 'node-limit' | 'region-limit' | 'depth-limit' | 'unsupported-html' | 'external-mutation'
export interface MarkdownViewUpdate {
  mode: 'unchanged' | 'patch' | 'replace'
  reason?: MarkdownViewFallback
  reusedRegions: number
  removedRegions: number
  insertedRegions: number
  /** Changed top-level regions patched in place. Omitted when zero. */
  patchedRegions?: number
}
interface Region { node: Node; key: string; nodes: number; tree?: DomTree; cleanup?: () => void; update?: () => void }

function bound(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${name} must be a non-negative safe integer`)
  return value
}

/** Own an HTML div's children. HTML must already satisfy the application's trust and sanitizer policy. */
export function createMarkdownView(root: HTMLElement, options: MarkdownViewOptions = {}) {
  if (root.namespaceURI !== HTML_NAMESPACE || root.localName !== 'div') throw new TypeError('Markdown view requires an HTML div')
  const maxCodeHtml = bound(options.maxCodeBlockHtmlLength ?? 0, 'maxCodeBlockHtmlLength')
  const maxHtml = bound(options.maxCachedHtmlLength ?? 2_000_000, 'maxCachedHtmlLength')
  const maxNodes = bound(options.maxNodes ?? 50_000, 'maxNodes')
  const maxRegions = bound(options.maxRegions ?? 4_096, 'maxRegions')
  const maxDepth = bound(options.maxDepth ?? 128, 'maxDepth')
  const patchChildren = options.patchChildren ?? true
  if (typeof patchChildren !== 'boolean') throw new TypeError('patchChildren must be a boolean')
  const codePatcher = maxCodeHtml && !options.initialize ? createCodeBlockPatcher(root, { maxHtml: maxCodeHtml, maxNodes, maxDepth, maxRegions }, patchChildren) : undefined
  let element: HTMLElement | undefined = root, initialize = options.initialize
  let regions: Region[] = [], previousHtml: string | undefined, replacementCleanup: (() => void) | undefined
  let closed = false, updating = false, cachedUnits = 0, updates = 0
  let last: MarkdownViewUpdate = { mode: 'unchanged', reusedRegions: 0, removedRegions: 0, insertedRegions: 0 }

  function checkOpen() { if (closed) throw new Error('Markdown view is closed') }
  function ownsChildren() {
    const nodes = element!.childNodes
    return nodes.length === regions.length && regions.every((region, i) => nodes[i] === region.node)
  }
  function cleanup(items: Region[]) {
    let failed = false, failure: unknown
    for (const item of items) {
      const dispose = item.cleanup; item.cleanup = undefined; item.update = undefined
      try { dispose?.() } catch (error) { if (!failed) { failed = true; failure = error } }
    }
    if (failed) throw failure
  }
  function clear() {
    codePatcher?.reset()
    const old = regions; regions = []; previousHtml = undefined; cachedUnits = 0
    const dispose = replacementCleanup; replacementCleanup = undefined
    let failed = false, failure: unknown
    try { cleanup(old) } catch (error) { failed = true; failure = error }
    try { dispose?.() } catch (error) { if (!failed) { failed = true; failure = error } }
    if (failed) throw failure
  }
  function dispose() {
    if (closed) return
    closed = true
    codePatcher?.dispose()
    try { clear() } finally { element?.replaceChildren(); element = undefined; initialize = undefined }
  }
  function connect(region: HTMLElement) {
    const lifecycle = initialize?.(region)
    let release: (() => void) | undefined, update: (() => void) | undefined
    try {
      if (typeof lifecycle === 'function') release = lifecycle
      else if (lifecycle !== undefined) {
        const dispose = lifecycle?.dispose
        if (typeof dispose !== 'function') throw new TypeError('Markdown view lifecycle requires a dispose function')
        release = dispose.bind(lifecycle)
        checkOpen()
        const refresh = lifecycle.update
        if (typeof refresh !== 'function') throw new TypeError('Markdown view lifecycle requires an update function')
        update = refresh.bind(lifecycle)
      }
      checkOpen()
      return { cleanup: release, update }
    } catch (error) {
      try { release?.() } catch { /* Preserve the registration error after releasing known setup. */ }
      throw error
    }
  }
  function replace(html: string, reason: MarkdownViewFallback): MarkdownViewUpdate {
    const removedRegions = element!.childNodes.length
    clear(); checkOpen()
    element!.innerHTML = html
    replacementCleanup = connect(element!).cleanup
    return { mode: 'replace', reason, reusedRegions: 0, removedRegions, insertedRegions: element!.childNodes.length }
  }
  function prepare(html: string): Region[] | MarkdownViewFallback {
    // Template contents have an inert owner document: no script execution, element upgrades, or resource loads.
    // Unsupported nodes never leave that document. Replacement retains ordinary innerHTML behavior.
    const template = element!.ownerDocument.createElement('template')
    template.innerHTML = html
    if (template.content.childNodes.length > maxRegions) return 'region-limit'
    if (template.content.childNodes.length > maxNodes) return 'node-limit'
    const prepared: Region[] = []
    const validated = new Map(regions.map(region => [region.key, region]))
    let units = html.length, count = 0
    for (const node of template.content.childNodes) {
      const key = node.nodeType + ':' + (node.nodeType === 1 ? (node as Element).outerHTML : node.nodeValue)
      units += key.length
      if (units > maxHtml) return 'html-limit'
      const previous = validated.get(key)
      let nodes = previous?.nodes ?? 0
      if (previous) {
        // Canonical template HTML already passed these fixed limits. Count every occurrence,
        // including duplicates, without inspecting the initialized live DOM.
        count += nodes
        if (count > maxNodes) return 'node-limit'
      } else {
        const stack: Array<{ node: Node; depth: number }> = [{ node, depth: 1 }]
        while (stack.length) {
          const { node: current, depth } = stack.pop()!
          nodes++
          if (++count > maxNodes) return 'node-limit'
          if (depth > maxDepth) return 'depth-limit'
          if (current.nodeType === 1) {
            const tag = current as Element
            if (!patchableElement(tag, depth)) return 'unsupported-html'
          } else if (current.nodeType !== 3 && current.nodeType !== 8) return 'unsupported-html'
          // Bound the traversal stack before collecting a wide sibling list.
          for (let child = current.lastChild; child; child = child.previousSibling) {
            if (stack.length + count >= maxNodes) return 'node-limit'
            stack.push({ node: child, depth: depth + 1 })
          }
        }
      }
      const tree = patchChildren ? previous?.tree ?? captureTree(node, maxHtml - units) : undefined
      if (patchChildren && (!tree || tree.units > maxHtml - units)) return 'html-limit'
      units += tree?.units ?? 0
      prepared.push({ node, key, nodes, tree })
    }
    return prepared
  }

  return {
    update(html: string): MarkdownViewUpdate {
      checkOpen()
      if (updating) { dispose(); throw new TypeError('Markdown view update is reentrant') }
      if (typeof html !== 'string') throw new TypeError('Markdown view HTML must be a string')
      updating = true
      try {
        let result: MarkdownViewUpdate
        const codePatch = codePatcher?.patch(html)
        const owned = ownsChildren()
        if (codePatch?.mode === 'invalidated') result = replace(html, 'external-mutation')
        else if (codePatch) {
          regions = []; previousHtml = undefined; cachedUnits = 0
          result = { ...codePatch, mode: codePatch.mode }
        } else if (previousHtml === html && owned) {
          result = { mode: 'unchanged', reusedRegions: regions.length, removedRegions: 0, insertedRegions: 0 }
        } else if (html.length > maxHtml) result = replace(html, 'html-limit')
        else {
          const next = prepare(html)
          if (typeof next === 'string') result = replace(html, next)
          else if (!owned && previousHtml !== undefined) result = replace(html, 'external-mutation')
          else {
            let untrackedRemoved = 0
            if (previousHtml === undefined) {
              clear(); checkOpen()
              untrackedRemoved = element!.childNodes.length
              if (untrackedRemoved) element!.replaceChildren()
            }
            let prefix = 0, suffix = 0
            while (prefix < regions.length && prefix < next.length && regions[prefix].key === next[prefix].key) prefix++
            while (suffix < regions.length - prefix && suffix < next.length - prefix
              && regions[regions.length - suffix - 1].key === next[next.length - suffix - 1].key) suffix++
            const oldMiddle = regions.slice(prefix, regions.length - suffix)
            const middle = next.slice(prefix, next.length - suffix)
            const patched = new Map<Region, Region>()
            const unchanged = new Set<Region>()
            for (let i = 0; i < Math.min(oldMiddle.length, middle.length); i++) {
              const old = oldMiddle[i], fresh = middle[i]
              if (old.key === fresh.key) { patched.set(old, fresh); unchanged.add(old) }
              else if (old.tree && fresh.tree && (!initialize || old.update) && !old.tree.blocked && !fresh.tree.blocked
                && canPatchTree(old.tree, fresh.tree) && ownsTree(old.tree)) patched.set(old, fresh)
            }
            const removed = oldMiddle.filter(region => !patched.has(region))
            const callsCleanup = removed.some(region => region.cleanup !== undefined)
            cleanup(removed); checkOpen()
            if (!ownsChildren()) throw new TypeError('Markdown view cleanup changed region ownership')
            // Only a user cleanup can change descendants after the first ownership check.
            if (callsCleanup) for (const old of patched.keys()) if (!unchanged.has(old) && !ownsTree(old.tree!)) throw new TypeError('Markdown view cleanup changed descendant ownership')
            const patchTargets = new Set(patched.values())
            const added = middle.filter(region => !patchTargets.has(region))
            // Cached snapshots can describe another equal region. New or changed regions need their own node references.
            function materialize(region: Region) {
              if (region.tree && region.tree.node !== region.node) {
                const tree = captureTree(region.node, region.tree.units)
                if (!tree) throw new TypeError('Markdown view canonical snapshot changed')
                region.tree = tree
              }
            }
            for (const region of added) materialize(region)
            for (let i = 0; i < oldMiddle.length; i++) {
              const old = oldMiddle[i], fresh = patched.get(old)
              if (!fresh) continue
              if (!unchanged.has(old)) {
                materialize(fresh)
                old.tree = patchTree(old.tree!, fresh.tree!)
                old.key = fresh.key
                old.nodes = fresh.nodes
              }
              middle[i] = old
            }
            // Reuse the prepared fragment for complete replacements instead of moving each node twice.
            const whole = prefix === 0 && suffix === 0 && patched.size === 0
            const fragment = whole && next.length ? next[0].node.parentNode as DocumentFragment : element!.ownerDocument.createDocumentFragment()
            if (whole) element!.replaceChildren(fragment)
            else {
              for (const region of removed) element!.removeChild(region.node)
              let anchor = suffix ? regions[regions.length - suffix].node : null
              for (let i = middle.length - 1; i >= 0; i--) {
                const region = middle[i]
                if (!patched.has(region)) element!.insertBefore(region.node, anchor)
                anchor = region.node
              }
            }
            const retained = [...regions.slice(0, prefix), ...middle, ...(suffix ? regions.slice(-suffix) : [])]
            regions = retained
            previousHtml = html
            cachedUnits = html.length + regions.reduce((total, region) => total + region.key.length + (region.tree?.units ?? 0), 0)
            for (const region of middle) {
              if (patched.has(region)) { if (!unchanged.has(region)) region.update?.(); checkOpen() }
              else if (region.node.nodeType === 1) Object.assign(region, connect(region.node as HTMLElement))
            }
            if (!ownsChildren()) throw new TypeError('Markdown view initializer changed region ownership')
            result = { mode: 'patch', reusedRegions: prefix + suffix + unchanged.size, removedRegions: removed.length + untrackedRemoved, insertedRegions: added.length }
            if (patched.size > unchanged.size) result.patchedRegions = patched.size - unchanged.size
          }
        }
        if (!codePatch || codePatch.mode === 'invalidated') codePatcher?.capture(html)
        checkOpen(); updates++; last = result
        return { ...result }
      } catch (error) {
        // A lifecycle error is never retried through full replacement.
        try { dispose() } catch { /* Keep the original failure after releasing every region. */ }
        throw error
      } finally { updating = false }
    },
    dispose,
    get metrics() { return { updates, cachedRegions: regions.length, cachedNodes: regions.reduce((total, region) => total + (region.tree?.count ?? 0), 0), cachedHtmlCodeUnits: cachedUnits, ...(codePatcher ? codePatcher.metrics : {}), ...last } },
  }
}
