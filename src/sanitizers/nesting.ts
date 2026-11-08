/**
 * HTML nesting depth, measured as htmlparser2 12, the parser sanitize-html
 * uses, measures it, in linear time.
 *
 * htmlparser2 keeps its open elements with the innermost first, so each
 * element it opens moves every open one, and each end tag searches them all.
 * 1 MB of open tags took 6 to 14 seconds to sanitize, though sanitize-html
 * keeps nothing past its nesting limit of 100. This replays the parser's own
 * tokenizer and its stack rules (implied end tags, void elements, foreign
 * content) on a stack kept innermost last, so it measures the same depth
 * the parser would reach without the parser's cost.
 */

import { Tokenizer } from 'htmlparser2'

/**
 * The deepest HTML the structural sanitizer accepts. sanitize-html drops
 * elements past depth 100, so nothing deeper can reach its output.
 */
export const MAX_HTML_NESTING_DEPTH = 256

// htmlparser2's ForeignContext.
const NONE = 0
const SVG = 1
const MATHML = 2

// The rest is copied from htmlparser2 12's Parser.
const formTags = new Set(['input', 'option', 'optgroup', 'select', 'button', 'datalist', 'textarea'])
const pTag = new Set(['p'])
const headingTags = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p'])
const tableSectionTags = new Set(['thead', 'tbody'])
const ddtTags = new Set(['dd', 'dt'])
const rtpTags = new Set(['rt', 'rp'])
const openImpliesClose = new Map<string, ReadonlySet<string>>([
  ['tr', new Set(['tr', 'th', 'td'])],
  ['th', new Set(['th'])],
  ['td', new Set(['thead', 'th', 'td'])],
  ['body', new Set(['head', 'link', 'script'])],
  ['a', new Set(['a'])],
  ['li', new Set(['li'])],
  ['p', pTag],
  ['h1', headingTags],
  ['h2', headingTags],
  ['h3', headingTags],
  ['h4', headingTags],
  ['h5', headingTags],
  ['h6', headingTags],
  ['select', formTags],
  ['input', formTags],
  ['output', formTags],
  ['button', formTags],
  ['datalist', formTags],
  ['textarea', formTags],
  ['option', new Set(['option'])],
  ['optgroup', new Set(['optgroup', 'option'])],
  ['dd', ddtTags],
  ['dt', ddtTags],
  ['address', pTag],
  ['article', pTag],
  ['aside', pTag],
  ['blockquote', pTag],
  ['details', pTag],
  ['div', pTag],
  ['dl', pTag],
  ['fieldset', pTag],
  ['figcaption', pTag],
  ['figure', pTag],
  ['footer', pTag],
  ['form', pTag],
  ['header', pTag],
  ['hr', pTag],
  ['main', pTag],
  ['nav', pTag],
  ['ol', pTag],
  ['pre', pTag],
  ['section', pTag],
  ['table', pTag],
  ['ul', pTag],
  ['rt', rtpTags],
  ['rp', rtpTags],
  ['tbody', tableSectionTags],
  ['tfoot', tableSectionTags],
])
const voidElements = new Set([
  'area', 'base', 'basefont', 'br', 'col', 'command', 'embed', 'frame', 'hr', 'img',
  'input', 'isindex', 'keygen', 'link', 'meta', 'param', 'source', 'track', 'wbr',
])
const foreignContextElements = new Set(['math', 'svg'])
const htmlIntegrationElements = new Set([
  'mi', 'mo', 'mn', 'ms', 'mtext', 'annotation-xml', 'foreignObject', 'desc', 'title',
])
const svgTagNameAdjustments = new Map([
  ['altglyph', 'altGlyph'], ['altglyphdef', 'altGlyphDef'], ['altglyphitem', 'altGlyphItem'],
  ['animatecolor', 'animateColor'], ['animatemotion', 'animateMotion'],
  ['animatetransform', 'animateTransform'], ['clippath', 'clipPath'], ['feblend', 'feBlend'],
  ['fecolormatrix', 'feColorMatrix'], ['fecomponenttransfer', 'feComponentTransfer'],
  ['fecomposite', 'feComposite'], ['feconvolvematrix', 'feConvolveMatrix'],
  ['fediffuselighting', 'feDiffuseLighting'], ['fedisplacementmap', 'feDisplacementMap'],
  ['fedistantlight', 'feDistantLight'], ['fedropshadow', 'feDropShadow'], ['feflood', 'feFlood'],
  ['fefunca', 'feFuncA'], ['fefuncb', 'feFuncB'], ['fefuncg', 'feFuncG'], ['fefuncr', 'feFuncR'],
  ['fegaussianblur', 'feGaussianBlur'], ['feimage', 'feImage'], ['femerge', 'feMerge'],
  ['femergenode', 'feMergeNode'], ['femorphology', 'feMorphology'], ['feoffset', 'feOffset'],
  ['fepointlight', 'fePointLight'], ['fespecularlighting', 'feSpecularLighting'],
  ['fespotlight', 'feSpotLight'], ['fetile', 'feTile'], ['feturbulence', 'feTurbulence'],
  ['foreignobject', 'foreignObject'], ['glyphref', 'glyphRef'],
  ['lineargradient', 'linearGradient'], ['radialgradient', 'radialGradient'],
  ['textpath', 'textPath'],
])

/**
 * The deepest the HTML parser's stack of open elements gets on `html`,
 * stopping once it passes `limit`.
 */
export function htmlNestingDepth(html: string, limit = Infinity): number {
  const stack: string[] = []
  const open = new Map<string, number>()
  const foreign = [NONE]
  let tagname = ''
  let deepest = 0

  const inForeignContext = (): boolean => foreign[foreign.length - 1] !== NONE
  const isOpen = (name: string): boolean => (open.get(name) ?? 0) > 0

  const readTagName = (start: number, endIndex: number): string => {
    const name = html.slice(start, endIndex).toLowerCase()
    if (foreign[foreign.length - 1] === SVG) return svgTagNameAdjustments.get(name) ?? name
    if (foreign.length > 1) {
      const adjusted = svgTagNameAdjustments.get(name)
      if (adjusted !== undefined && isOpen(adjusted)) return adjusted
    }
    if (!inForeignContext()) return name === 'image' ? 'img' : name
    return name
  }

  const popElement = (): void => {
    const element = stack.pop()!
    open.set(element, open.get(element)! - 1)
    if (foreignContextElements.has(element) || htmlIntegrationElements.has(element)) foreign.pop()
  }

  const emitOpenTag = (name: string): void => {
    tagname = name
    if (name === 'form' && isOpen('form')) {
      tagname = ''
      return
    }
    const impliesClose = openImpliesClose.get(name)
    if (impliesClose) {
      while (stack.length > 0 && impliesClose.has(stack[stack.length - 1]!)) popElement()
    }
    if (voidElements.has(name)) return
    stack.push(name)
    open.set(name, (open.get(name) ?? 0) + 1)
    if (name === 'svg') foreign.push(SVG)
    else if (name === 'math') foreign.push(MATHML)
    else if (htmlIntegrationElements.has(name)) foreign.push(NONE)
    if (stack.length > deepest) deepest = stack.length
    if (deepest > limit) throw new NestingLimit()
  }

  const tokenizer = new Tokenizer({ xmlMode: false, decodeEntities: true }, {
    onopentagname: (start, endIndex) => emitOpenTag(readTagName(start, endIndex)),
    onopentagend: () => {
      tagname = ''
    },
    onselfclosingtag: () => {
      // Self-closing syntax closes an element only in foreign content.
      if (inForeignContext() && stack[stack.length - 1] === tagname) popElement()
      tagname = ''
    },
    onclosetag: (start, endIndex) => {
      const name = readTagName(start, endIndex)
      // `</br>` opens and closes a br without stacking it.
      if (voidElements.has(name)) return
      if (isOpen(name)) {
        while (stack[stack.length - 1] !== name) popElement()
        popElement()
      } else if (name === 'p') {
        // `</p>` with no p open opens one and closes it.
        emitOpenTag('p')
        if (stack[stack.length - 1] === 'p') popElement()
        tagname = ''
      }
    },
    isInForeignContext: inForeignContext,
    onattribdata() {},
    onattribentity() {},
    onattribend() {},
    onattribname() {},
    oncdata() {},
    oncomment() {},
    ondeclaration() {},
    onend() {},
    onprocessinginstruction() {},
    ontext() {},
    ontextentity() {},
  })
  try {
    tokenizer.write(html)
    tokenizer.end()
  } catch (error) {
    if (!(error instanceof NestingLimit)) throw error
  }
  return deepest
}

class NestingLimit extends Error {}

/**
 * Throws a RangeError when `html` nests deeper than the parser behind the
 * structural sanitizer handles in reasonable time.
 */
export function assertHtmlNesting(html: string, limit = MAX_HTML_NESTING_DEPTH): void {
  if (htmlNestingDepth(html, limit) > limit) {
    throw new RangeError(`HTML nesting exceeds ${limit} elements`)
  }
}
