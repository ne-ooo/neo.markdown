const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml'
const UNSUPPORTED = new Set(['script', 'style', 'template', 'noscript', 'plaintext', 'xmp', 'textarea', 'title', 'base', 'link', 'meta', 'form'])
const TABLE_PARTS = new Set(['caption', 'col', 'colgroup', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th'])

export function patchableElement(tag: Element, depth: number): boolean {
  if (tag.namespaceURI !== HTML_NAMESPACE || UNSUPPORTED.has(tag.localName) || tag.localName.includes('-') || tag.hasAttribute('is')
    || (depth === 1 && TABLE_PARTS.has(tag.localName))) return false
  for (const name of tag.getAttributeNames()) if (/^on/i.test(name)) return false
  return true
}
