// Only ordinary content containers can change in place. Controls and unknown elements are atomic.
const CONTAINERS = new Set(('a abbr article aside b blockquote caption code colgroup dd del div dl dt em figcaption figure footer h1 h2 h3 h4 h5 h6 header i ins kbd li main mark nav ol p pre s samp section small span strong sub sup table tbody td tfoot th thead tr u ul var').split(' '))

export interface DomTree {
  node: Node
  own: string
  tag: string
  id: string | null
  container: boolean
  blocked: boolean
  children: DomTree[]
  hash: number
  units: number
  count: number
}

/** Capture canonical structure before any initializer can change the live nodes. */
export function captureTree(node: Node, maxUnits: number, atomic?: ReadonlyMap<Node, string>): DomTree | undefined {
  let units = 0
  const all: DomTree[] = []
  function make(node: Node): DomTree {
    const element = node.nodeType === 1 ? node as Element : undefined
    const tag = element?.localName ?? ''
    const attributes = element ? element.getAttributeNames().map(name => [name, element.getAttribute(name)!]) : []
    const identity = atomic?.get(node)
    const own = (element ? JSON.stringify(attributes) : node.nodeType + ':' + node.nodeValue) + (identity === undefined ? '' : '\u0000' + identity)
    let id: string | null = null, editable = false, blocked = false
    for (const [name, value] of attributes) {
      if (name === 'id') id = value
      if (name === 'contenteditable') editable = true
      if ((name === 'class' && /(?:^|\s)(?:embed|twitter-tweet)(?:\s|$)/.test(value)) || name.startsWith('data-embed-') || name.startsWith('data-neo-embed-')) blocked = true
    }
    units += own.length + tag.length + (id?.length ?? 0)
    const tree = { node, own, tag, id, container: CONTAINERS.has(tag) && !editable && identity === undefined, blocked, children: [], hash: 0, units: 0, count: 0 }
    all.push(tree)
    return tree
  }
  const root = make(node)
  for (let i = 0; i < all.length; i++) {
    if (units > maxUnits) return undefined
    const tree = all[i]
    if (atomic?.has(tree.node)) continue
    for (let child = tree.node.firstChild; child; child = child.nextSibling) {
      tree.children.push(make(child))
      if (units > maxUnits) return undefined
    }
  }
  for (let i = all.length - 1; i >= 0; i--) {
    const tree = all[i]
    let hash = 2166136261
    for (const character of [tree.tag, tree.own]) for (let at = 0; at < character.length; at++) hash = Math.imul(hash ^ character.charCodeAt(at), 16777619)
    for (const child of tree.children) { hash = Math.imul(hash ^ child.hash, 16777619); tree.blocked ||= child.blocked }
    tree.hash = hash
    tree.count = 1 + tree.children.reduce((sum, child) => sum + child.count, 0)
  }
  root.units = units
  return root
}

// Hashes only reject unequal candidates. Full structural comparison decides reuse, including collisions.
function equal(a: DomTree, b: DomTree): boolean {
  const stack = [[a, b]]
  while (stack.length) {
    const [left, right] = stack.pop()!
    if (left.hash !== right.hash || left.own !== right.own || left.tag !== right.tag || left.children.length !== right.children.length) return false
    for (let i = 0; i < left.children.length; i++) stack.push([left.children[i], right.children[i]])
  }
  return true
}

export function canPatchTree(a: DomTree, b: DomTree): boolean {
  return a.node.nodeType === b.node.nodeType && (a.node.nodeType === 3 || a.node.nodeType === 8
    || (a.container && b.container && a.tag === b.tag && a.id === b.id))
}

/** Atomic controls can own descendants. Container children must still match their canonical node references. */
export function ownsTree(tree: DomTree): boolean {
  const stack = [tree]
  while (stack.length) {
    const current = stack.pop()!
    if (!current.container) continue
    let node = current.node.firstChild
    for (const child of current.children) {
      if (node !== child.node) return false
      stack.push(child)
      node = node.nextSibling
    }
    if (node) return false
  }
  return true
}

function attributes(current: Element, next: Element): void {
  const before = Array.from(current.attributes), after = Array.from(next.attributes)
  // Preserve attribute order as well as values, so serialization matches ordinary replacement.
  if (before.length !== after.length || before.some((attribute, i) => attribute.name !== after[i].name)) {
    for (const attribute of before) current.removeAttribute(attribute.name)
    for (const attribute of after) current.setAttribute(attribute.name, attribute.value)
  } else for (const attribute of after) if (current.getAttribute(attribute.name) !== attribute.value) current.setAttribute(attribute.name, attribute.value)
}

/** Apply an already bounded, ownership-checked tree. No initializer runs inside this operation. */
export function patchTree(before: DomTree, after: DomTree, descendants = true): DomTree {
  const stack = [[before, after]]
  while (stack.length) {
    const [old, next] = stack.pop()!
    if (old.node.nodeType !== 1) {
      const current = old.node as CharacterData, value = next.node.nodeValue ?? '', previous = current.data
      let prefix = 0, suffix = 0
      while (prefix < previous.length && prefix < value.length && previous[prefix] === value[prefix]) prefix++
      while (suffix < previous.length - prefix && suffix < value.length - prefix && previous[previous.length - suffix - 1] === value[value.length - suffix - 1]) suffix++
      current.replaceData(prefix, previous.length - prefix - suffix, value.slice(prefix, value.length - suffix))
      next.node = old.node
      continue
    }
    const parent = old.node as Element
    if (old.own !== next.own) attributes(parent, next.node as Element)
    let prefix = 0, suffix = 0
    while (prefix < old.children.length && prefix < next.children.length && equal(old.children[prefix], next.children[prefix])) {
      next.children[prefix] = old.children[prefix]; prefix++
    }
    while (suffix < old.children.length - prefix && suffix < next.children.length - prefix
      && equal(old.children[old.children.length - suffix - 1], next.children[next.children.length - suffix - 1])) {
      next.children[next.children.length - suffix - 1] = old.children[old.children.length - suffix - 1]; suffix++
    }
    const removed = old.children.slice(prefix, old.children.length - suffix)
    const added = next.children.slice(prefix, next.children.length - suffix)
    const pairs = Math.min(removed.length, added.length)
    for (let i = 0; i < pairs; i++) {
      if (equal(removed[i], added[i])) next.children[prefix + i] = removed[i]
      else if (descendants && canPatchTree(removed[i], added[i])) stack.push([removed[i], added[i]])
      else parent.replaceChild(added[i].node, removed[i].node)
    }
    for (let i = pairs; i < removed.length; i++) parent.removeChild(removed[i].node)
    if (added.length > pairs) {
      const fragment = parent.ownerDocument.createDocumentFragment()
      for (let i = pairs; i < added.length; i++) fragment.appendChild(added[i].node)
      parent.insertBefore(fragment, suffix ? old.children[old.children.length - suffix].node : null)
    }
    next.node = old.node
  }
  return after
}
