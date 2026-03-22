/**
 * Individual block-level tokenization rules (tree-shakeable)
 *
 * Each function creates a BlockRule that can be passed to `createParser({ blocks: [...] })`.
 * Import only the rules you need for optimal bundle size.
 *
 * @example
 * ```typescript
 * import { createParser } from '@lpm.dev/neo.markdown/core'
 * import { heading, paragraph, code, list } from '@lpm.dev/neo.markdown/blocks'
 *
 * const parser = createParser({ blocks: [heading, paragraph, code, list] })
 * ```
 */

import type { BlockRule, TableCell } from '../core/types.js'

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

const PATTERNS = {
  code: /^( {0,3})(```|~~~)([^`\n]*)\n([\s\S]*?)\n\2/,
  indentedCode: /^(?: {4}|\t).+(?:\n(?: {4}|\t).+)*(?:\n|$)/,
  heading: /^ {0,3}(#{1,6})(?=\s|$)(.*)(?:\n+|$)/,
  setextHeading: /^([^\n]+)\n( {0,3})(=+|-+) *(?:\n+|$)/,
  hr: /^ {0,3}((?:- *){3,}|(?:_ *){3,}|(?:\* *){3,})(?:\n+|$)/,
  blockquote: /^(?:> ?[^\n]*\n?)+/,
  list: /^( {0,3})([*+-]|\d{1,9}[.)]) [\s\S]+?(?:\n{2,}(?! )(?!\1(?:[*+-]|\d{1,9}[.)]) )\n*|\s*$)/,
  table: /^ {0,3}(\S.*\|.*)\n {0,3}([ :|-]+\|[ :|-]*)\n((?:.*\|.*(?:\n|$))*)/,
  html: /^ {0,3}(?:<(?:script|pre|style|textarea)[>\s][\s\S]*?(?:<\/(?:script|pre|style|textarea)>|$)|<!--[\s\S]*?(?:-->|$)|<\?[\s\S]*?\?>|<![A-Z][\s\S]*?>|<!\[CDATA\[[\s\S]*?(?:\]\]>|$)|<\/?(address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|section|source|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:\s|\/?>|\/>|$)[\s\S]*?(?:\n{2,}|$))/i,
  paragraph: /^([^\n]+(?:\n(?![ \t]*\n)[^\n]+)*)/,
}

// ---------------------------------------------------------------------------
// Fenced code block
// ---------------------------------------------------------------------------

/** Fenced code block rule (``` or ~~~) */
export const code: BlockRule = {
  name: 'code',
  priority: 900,
  tokenize(src) {
    const match = PATTERNS.code.exec(src)
    if (!match) return null

    const raw = match[0]
    const infoString = match[3]?.trim() ?? ''
    const text = match[4] || ''

    let lang: string | undefined
    let meta: string | undefined

    if (infoString) {
      const spaceIdx = infoString.indexOf(' ')
      if (spaceIdx === -1) {
        lang = infoString
      } else {
        lang = infoString.substring(0, spaceIdx)
        meta = infoString.substring(spaceIdx + 1).trim() || undefined
      }
    }

    return { token: { type: 'code', raw, lang, meta, text }, raw }
  },
}

// ---------------------------------------------------------------------------
// Indented code block
// ---------------------------------------------------------------------------

/** Indented code block rule (4 spaces or tab) */
export const indentedCode: BlockRule = {
  name: 'indentedCode',
  priority: 500,
  tokenize(src) {
    const match = PATTERNS.indentedCode.exec(src)
    if (!match) return null

    const raw = match[0]
    const text = raw
      .split('\n')
      .map((line) => {
        if (line.startsWith('    ')) return line.substring(4)
        if (line.startsWith('\t')) return line.substring(1)
        return line
      })
      .join('\n')
      .replace(/\n+$/, '')

    return { token: { type: 'code', raw, lang: undefined, text }, raw }
  },
}

// ---------------------------------------------------------------------------
// ATX heading (# style)
// ---------------------------------------------------------------------------

/** ATX heading rule (# heading) */
export const heading: BlockRule = {
  name: 'heading',
  priority: 800,
  tokenize(src) {
    const match = PATTERNS.heading.exec(src)
    if (!match) return null

    const raw = match[0]
    const level = match[1].length as 1 | 2 | 3 | 4 | 5 | 6
    const text = match[2].trim()

    return { token: { type: 'heading', raw, level, text, tokens: [] }, raw }
  },
}

// ---------------------------------------------------------------------------
// Setext heading (=== or --- underline)
// ---------------------------------------------------------------------------

/** Setext heading rule (underlined with === or ---) */
export const setextHeading: BlockRule = {
  name: 'setextHeading',
  priority: 850,
  tokenize(src) {
    const match = PATTERNS.setextHeading.exec(src)
    if (!match) return null

    const raw = match[0]
    const text = match[1].trim()
    const underline = match[3]
    const level = underline[0] === '=' ? 1 : 2

    return { token: { type: 'heading', raw, level: level as 1 | 2, text, tokens: [] }, raw }
  },
}

// ---------------------------------------------------------------------------
// Horizontal rule
// ---------------------------------------------------------------------------

/** Horizontal rule (---, ***, ___) */
export const hr: BlockRule = {
  name: 'hr',
  priority: 750,
  tokenize(src) {
    const match = PATTERNS.hr.exec(src)
    if (!match) return null
    const raw = match[0]
    return { token: { type: 'hr', raw }, raw }
  },
}

// ---------------------------------------------------------------------------
// Table (GFM)
// ---------------------------------------------------------------------------

function parseTableRow(line: string): TableCell[] {
  const trimmed = line.trim().replace(/^\||\|$/g, '')
  const cellTexts = trimmed.split('|').map((cell) => cell.trim())
  return cellTexts.map((text) => ({ text, tokens: [] }))
}

function parseTableAlignment(line: string): Array<'left' | 'center' | 'right' | null> {
  const trimmed = line.trim().replace(/^\||\|$/g, '')
  const delimiters = trimmed.split('|').map((d) => d.trim())
  return delimiters.map((delimiter) => {
    const hasLeft = delimiter.startsWith(':')
    const hasRight = delimiter.endsWith(':')
    if (hasLeft && hasRight) return 'center'
    if (hasRight) return 'right'
    if (hasLeft) return 'left'
    return null
  })
}

/** GFM table rule */
export const table: BlockRule = {
  name: 'table',
  priority: 700,
  tokenize(src, options) {
    if (options?.gfm === false) return null

    const match = PATTERNS.table.exec(src)
    if (!match) return null

    const raw = match[0]
    const headerLine = match[1]
    const delimiterLine = match[2]
    const bodyLines = match[3] || ''

    const align = parseTableAlignment(delimiterLine)
    if (align.length === 0) return null

    const headerCells = parseTableRow(headerLine)
    while (headerCells.length < align.length) headerCells.push({ text: '', tokens: [] })
    if (headerCells.length > align.length) headerCells.splice(align.length)

    const rows: TableCell[][] = []
    if (bodyLines.trim()) {
      for (const line of bodyLines.trim().split('\n')) {
        if (line.includes('|')) {
          const cells = parseTableRow(line)
          while (cells.length < align.length) cells.push({ text: '', tokens: [] })
          if (cells.length > align.length) cells.splice(align.length)
          rows.push(cells)
        }
      }
    }

    return { token: { type: 'table', raw, header: headerCells, align, rows }, raw }
  },
}

// ---------------------------------------------------------------------------
// Blockquote
// ---------------------------------------------------------------------------

/** Blockquote rule (> prefix) */
export const blockquote: BlockRule = {
  name: 'blockquote',
  priority: 650,
  tokenize(src) {
    const match = PATTERNS.blockquote.exec(src)
    if (!match) return null

    const raw = match[0]
    // Note: inner content is recursively tokenized by the Tokenizer class

    return { token: { type: 'blockquote', raw, tokens: [] }, raw }
  },
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

/** List rule (ordered and unordered, with task list support) */
export const list: BlockRule = {
  name: 'list',
  priority: 600,
  tokenize(src) {
    const match = PATTERNS.list.exec(src)
    if (!match) return null

    const raw = match[0]
    const bull = match[2]
    const ordered = bull.length > 1
    const start = ordered ? parseInt(bull, 10) : undefined

    return {
      token: { type: 'list', raw, ordered, start, items: [] },
      raw,
    }
  },
}

// ---------------------------------------------------------------------------
// HTML block
// ---------------------------------------------------------------------------

/** HTML block rule (only active when allowHtml is true) */
export const html: BlockRule = {
  name: 'html',
  priority: 550,
  tokenize(src, options) {
    if (!options?.allowHtml) return null

    const match = PATTERNS.html.exec(src)
    if (!match) return null

    const raw = match[0]
    const text = raw.trim()

    return { token: { type: 'html', raw, text }, raw }
  },
}

// ---------------------------------------------------------------------------
// Paragraph (fallback)
// ---------------------------------------------------------------------------

/** Paragraph rule (fallback for unmatched content) */
export const paragraph: BlockRule = {
  name: 'paragraph',
  priority: 100,
  tokenize(src) {
    const match = PATTERNS.paragraph.exec(src)
    if (!match) return null

    const raw = match[0]
    const text = match[1].trim()
    if (!text) return null

    return { token: { type: 'paragraph', raw, text, tokens: [] }, raw }
  },
}

// ---------------------------------------------------------------------------
// All built-in rules (for convenience)
// ---------------------------------------------------------------------------

/** All built-in block rules in default priority order */
export const allBlockRules: BlockRule[] = [
  code,
  setextHeading,
  heading,
  hr,
  table,
  blockquote,
  list,
  html,
  indentedCode,
  paragraph,
]
