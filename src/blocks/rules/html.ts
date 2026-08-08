import type { BlockRule } from '../../core/types.js'

const HTML = /^ {0,3}(?:<(?:script|pre|style|textarea)[>\s][\s\S]*?(?:<\/(?:script|pre|style|textarea)>|$)|<!--[\s\S]*?(?:-->|$)|<\?[\s\S]*?\?>|<![A-Z][\s\S]*?>|<!\[CDATA\[[\s\S]*?(?:\]\]>|$)|<\/?(address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|section|source|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:\s|\/?>|\/>|$)[\s\S]*?(?:\n{2,}|$))/i

/** Raw HTML block rule, active only when allowHtml is true. */
export const html: BlockRule = {
  name: 'html',
  priority: 550,
  starts: (src, options) => options.allowHtml === true && HTML.test(src),
  tokenize(src, options) {
    if (!options.allowHtml) return null
    const match = HTML.exec(src)
    if (!match) return null
    const raw = match[0]
    return { token: { type: 'html', raw, text: raw.trim() }, raw }
  },
}
