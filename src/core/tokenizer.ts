/**
 * Core tokenizer for block-level markdown parsing
 *
 * Uses an ordered rule array for extensibility via the plugin system.
 * Built-in rules have default priorities (code=900 ... paragraph=100).
 * Custom rules slot in by numeric priority or positional constraint.
 */

import type { BlockRule, BlockToken, ListItemToken, ParserOptions, TableCell } from './types.js'

/**
 * Internal rule representation (resolved priority, bound tokenize fn)
 */
interface InternalBlockRule {
  name: string
  priority: number
  tokenize: (src: string) => { token: BlockToken; raw: string } | null
}

/**
 * Block-level regex patterns
 */
const PATTERNS = {
  // Newline
  newline: /^\n+/,

  // Code block (fenced)
  code: /^( {0,3})(```|~~~)([^`\n]*)\n([\s\S]*?)\n\2/,

  // Indented code block (4 spaces or 1 tab)
  indentedCode: /^(?: {4}|\t).+(?:\n(?: {4}|\t).+)*(?:\n|$)/,

  // Heading (ATX style: # heading)
  heading: /^ {0,3}(#{1,6})(?=\s|$)(.*)(?:\n+|$)/,

  // Setext heading (underlined with === or ---)
  setextHeading: /^([^\n]+)\n( {0,3})(=+|-+) *(?:\n+|$)/,

  // Horizontal rule
  hr: /^ {0,3}((?:- *){3,}|(?:_ *){3,}|(?:\* *){3,})(?:\n+|$)/,

  // Blockquote - Match lines starting with >
  blockquote: /^(?:> ?[^\n]*\n?)+/,

  // List (unordered or ordered)
  list: /^( {0,3})([*+-]|\d{1,9}[.)]) [\s\S]+?(?:\n{2,}(?! )(?!\1(?:[*+-]|\d{1,9}[.)]) )\n*|\s*$)/,

  // Table (GFM) - Phase 4
  // Matches tables with at least one pipe
  table: /^ {0,3}(\S.*\|.*)\n {0,3}([ :|-]+\|[ :|-]*)\n((?:.*\|.*(?:\n|$))*)/,

  // HTML block
  html: /^ {0,3}(?:<(?:script|pre|style|textarea)[>\s][\s\S]*?(?:<\/(?:script|pre|style|textarea)>|$)|<!--[\s\S]*?(?:-->|$)|<\?[\s\S]*?\?>|<![A-Z][\s\S]*?>|<!\[CDATA\[[\s\S]*?(?:\]\]>|$)|<\/?(address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|section|source|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:\s|\/?>|\/>|$)[\s\S]*?(?:\n{2,}|$))/i,

  // Paragraph (fallback - everything else)
  paragraph: /^([^\n]+(?:\n(?![ \t]*\n)[^\n]+)*)/,
}

/**
 * Tokenizer class for parsing markdown into block tokens
 */
export class Tokenizer {
  private options: ParserOptions
  private rules: InternalBlockRule[]

  constructor(options: ParserOptions = {}, customRules: BlockRule[] = []) {
    this.options = options
    this.rules = options.blocks
      ? this.buildFromExternalRules(options.blocks, customRules)
      : this.buildRules(customRules)
  }

  /**
   * Build the ordered rules array from built-in + custom rules
   */
  private buildRules(customRules: BlockRule[]): InternalBlockRule[] {
    const builtins: InternalBlockRule[] = [
      { name: 'code', priority: 900, tokenize: (src) => this.tokenizeCode(src) },
      { name: 'setextHeading', priority: 850, tokenize: (src) => this.tokenizeSetextHeading(src) },
      { name: 'heading', priority: 800, tokenize: (src) => this.tokenizeHeading(src) },
      { name: 'hr', priority: 750, tokenize: (src) => this.tokenizeHr(src) },
      { name: 'table', priority: 700, tokenize: (src) => this.tokenizeTable(src) },
      { name: 'blockquote', priority: 650, tokenize: (src) => this.tokenizeBlockquote(src) },
      { name: 'list', priority: 600, tokenize: (src) => this.tokenizeList(src) },
      { name: 'html', priority: 550, tokenize: (src) => this.tokenizeHtml(src) },
      { name: 'indentedCode', priority: 500, tokenize: (src) => this.tokenizeIndentedCode(src) },
      { name: 'paragraph', priority: 100, tokenize: (src) => this.tokenizeParagraph(src) },
    ]

    if (customRules.length === 0) return builtins

    const all = [...builtins]
    for (const rule of customRules) {
      const priority = this.resolveRulePriority(rule, all)
      const opts = this.options
      all.push({
        name: rule.name,
        priority,
        tokenize: (src) => rule.tokenize(src, opts),
      })
    }

    // Sort by priority descending (highest = tried first)
    all.sort((a, b) => b.priority - a.priority)
    return all
  }

  /**
   * Build rules from user-provided block rule list (tree-shaking mode).
   * Uses the names from the provided rules to select which built-in rules to enable.
   * Complex rules (blockquote, list) use the internal implementations for correct recursion.
   */
  private buildFromExternalRules(blocks: BlockRule[], customRules: BlockRule[]): InternalBlockRule[] {
    const enabledNames = new Set(blocks.map((r) => r.name))

    // Build only the enabled built-in rules
    const builtinMap: Record<string, InternalBlockRule> = {
      code: { name: 'code', priority: 900, tokenize: (src) => this.tokenizeCode(src) },
      setextHeading: { name: 'setextHeading', priority: 850, tokenize: (src) => this.tokenizeSetextHeading(src) },
      heading: { name: 'heading', priority: 800, tokenize: (src) => this.tokenizeHeading(src) },
      hr: { name: 'hr', priority: 750, tokenize: (src) => this.tokenizeHr(src) },
      table: { name: 'table', priority: 700, tokenize: (src) => this.tokenizeTable(src) },
      blockquote: { name: 'blockquote', priority: 650, tokenize: (src) => this.tokenizeBlockquote(src) },
      list: { name: 'list', priority: 600, tokenize: (src) => this.tokenizeList(src) },
      html: { name: 'html', priority: 550, tokenize: (src) => this.tokenizeHtml(src) },
      indentedCode: { name: 'indentedCode', priority: 500, tokenize: (src) => this.tokenizeIndentedCode(src) },
      paragraph: { name: 'paragraph', priority: 100, tokenize: (src) => this.tokenizeParagraph(src) },
    }

    const all: InternalBlockRule[] = []

    for (const name of enabledNames) {
      const builtin = builtinMap[name]
      if (builtin) {
        all.push(builtin)
      } else {
        // External rule not matching a built-in — use as-is
        const rule = blocks.find((r) => r.name === name)
        if (rule) {
          const opts = this.options
          const priority = typeof rule.priority === 'number' ? rule.priority : 150
          all.push({ name: rule.name, priority, tokenize: (src) => rule.tokenize(src, opts) })
        }
      }
    }

    // Add plugin custom rules
    for (const rule of customRules) {
      const priority = this.resolveRulePriority(rule, all)
      const opts = this.options
      all.push({ name: rule.name, priority, tokenize: (src) => rule.tokenize(src, opts) })
    }

    all.sort((a, b) => b.priority - a.priority)
    return all
  }

  /**
   * Resolve a custom rule's priority to a numeric value
   */
  private resolveRulePriority(rule: BlockRule, existing: InternalBlockRule[]): number {
    if (rule.priority === undefined) return 150 // Default: before paragraph
    if (typeof rule.priority === 'number') return rule.priority

    // Positional constraint: "before:name" or "after:name"
    const colonIdx = rule.priority.indexOf(':')
    const position = rule.priority.slice(0, colonIdx)
    const targetName = rule.priority.slice(colonIdx + 1)
    const target = existing.find((r) => r.name === targetName)
    if (!target) return 150

    return position === 'before' ? target.priority + 1 : target.priority - 1
  }

  /**
   * Tokenize markdown string into block tokens
   *
   * @param src - Markdown source string
   * @returns Array of block tokens
   */
  tokenize(src: string): BlockToken[] {
    const tokens: BlockToken[] = []
    let markdown = src.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

    // Ensure trailing newline
    if (markdown && !markdown.endsWith('\n')) {
      markdown += '\n'
    }

    const rules = this.rules

    while (markdown) {
      let matched = false

      for (let i = 0; i < rules.length; i++) {
        const result = rules[i].tokenize(markdown)
        if (result) {
          tokens.push(result.token)
          markdown = markdown.slice(result.raw.length)
          matched = true
          break
        }
      }

      if (!matched) {
        // Skip single character if no match (shouldn't happen)
        markdown = markdown.slice(1)
      }
    }

    return tokens
  }

  /**
   * Tokenize fenced code block
   * Splits fence info string into lang and meta
   */
  private tokenizeCode(src: string): { token: BlockToken; raw: string } | null {
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

    return {
      token: {
        type: 'code',
        raw,
        lang,
        meta,
        text,
      },
      raw,
    }
  }

  /**
   * Tokenize indented code block (4 spaces or tab)
   */
  private tokenizeIndentedCode(src: string): { token: BlockToken; raw: string } | null {
    const match = PATTERNS.indentedCode.exec(src)
    if (!match) return null

    const raw = match[0]
    // Remove indentation (4 spaces or 1 tab) from each line
    const text = raw
      .split('\n')
      .map((line) => {
        if (line.startsWith('    ')) {
          return line.substring(4)
        }
        if (line.startsWith('\t')) {
          return line.substring(1)
        }
        return line
      })
      .join('\n')
      .replace(/\n+$/, '') // Remove trailing newlines

    return {
      token: {
        type: 'code',
        raw,
        lang: undefined,
        text,
      },
      raw,
    }
  }

  /**
   * Tokenize Setext-style heading (underlined with === or ---)
   */
  private tokenizeSetextHeading(src: string): { token: BlockToken; raw: string } | null {
    const match = PATTERNS.setextHeading.exec(src)
    if (!match) return null

    const raw = match[0]
    const text = match[1].trim()
    const underline = match[3]
    const level = underline[0] === '=' ? 1 : 2

    return {
      token: {
        type: 'heading',
        raw,
        level: level as 1 | 2,
        text,
        tokens: [], // Will be filled by inline parser
      },
      raw,
    }
  }

  /**
   * Tokenize heading (ATX style)
   */
  private tokenizeHeading(src: string): { token: BlockToken; raw: string } | null {
    const match = PATTERNS.heading.exec(src)
    if (!match) return null

    const raw = match[0]
    const level = match[1].length as 1 | 2 | 3 | 4 | 5 | 6
    const text = match[2].trim()

    return {
      token: {
        type: 'heading',
        raw,
        level,
        text,
        tokens: [], // Will be filled by inline parser
      },
      raw,
    }
  }

  /**
   * Tokenize horizontal rule
   */
  private tokenizeHr(src: string): { token: BlockToken; raw: string } | null {
    const match = PATTERNS.hr.exec(src)
    if (!match) return null

    const raw = match[0]

    return {
      token: {
        type: 'hr',
        raw,
      },
      raw,
    }
  }

  /**
   * Tokenize blockquote
   */
  private tokenizeBlockquote(src: string): { token: BlockToken; raw: string } | null {
    const match = PATTERNS.blockquote.exec(src)
    if (!match) return null

    const raw = match[0]
    const text = raw.replace(/^ *> ?/gm, '')

    // Recursively tokenize blockquote content
    const tokens = this.tokenize(text)

    return {
      token: {
        type: 'blockquote',
        raw,
        tokens,
      },
      raw,
    }
  }

  /**
   * Tokenize list with nested list support (Phase 2)
   */
  private tokenizeList(src: string): { token: BlockToken; raw: string } | null {
    const match = PATTERNS.list.exec(src)
    if (!match) return null

    const raw = match[0]
    const indent = match[1]
    const bull = match[2]
    const ordered = bull.length > 1
    const start = ordered ? parseInt(bull, 10) : undefined

    // Parse list items
    const items = this.parseListItems(raw, indent, ordered)

    return {
      token: {
        type: 'list',
        raw,
        ordered,
        start,
        items,
      },
      raw,
    }
  }

  /**
   * Parse list items with support for nested lists and multiple blocks
   * Phase 3: Enhanced to support mixed nested lists (ul in ol, ol in ul)
   * Phase 6: Optimized for performance (single-pass, reduced allocations)
   */
  private parseListItems(
    src: string,
    baseIndent: string,
    ordered: boolean
  ): ListItemToken[] {
    const lines = src.split('\n')
    const linesLen = lines.length
    const bulletRegex = ordered ? /^( *)(\d{1,9}[.)]) / : /^( *)([*+-]) /
    const baseIndentLen = baseIndent.length

    // Single-pass algorithm: detect loose + parse items simultaneously
    const items: ListItemToken[] = []
    let currentItem: { text: string; lines: string[]; bulletLength: number; task?: boolean; checked?: boolean } | null = null
    let isLoose = false
    let hasBlankLine = false

    for (let i = 0; i < linesLen; i++) {
      const line = lines[i]
      const bulletMatch = bulletRegex.exec(line) // exec is faster than match

      if (bulletMatch && bulletMatch[1].length === baseIndentLen) {
        // Detect loose lists: blank line before new item means loose
        if (hasBlankLine && currentItem) {
          isLoose = true
        }
        hasBlankLine = false

        // New list item at same level
        if (currentItem) {
          items.push(this.processListItem(currentItem, isLoose))
        }

        const bulletLength = bulletMatch[0].length
        const text = line.substring(bulletLength)

        // Phase 4: Check for task list checkbox (GFM extension)
        // Optimized: check first char before regex
        let task: boolean | undefined
        let checked: boolean | undefined
        let taskText = text

        if (text.charCodeAt(0) === 91) { // '[' char
          const taskMatch = /^\[([ xX])\] /.exec(text)
          if (taskMatch) {
            task = true
            checked = taskMatch[1] === 'x' || taskMatch[1] === 'X'
            taskText = text.substring(4) // '[x] ' is 4 chars
          }
        }

        currentItem = {
          text: taskText,
          lines: [taskText],
          bulletLength,
          task,
          checked,
        }
      } else if (currentItem) {
        // Continuation or nested content
        const trimmed = line.trim()
        if (trimmed === '') {
          hasBlankLine = true
          currentItem.lines.push('')
        } else {
          // Optimized indentation calculation
          const indent = baseIndentLen + currentItem.bulletLength
          let lineIndent = 0

          // Count leading spaces (faster than regex)
          for (let j = 0; j < line.length; j++) {
            if (line.charCodeAt(j) === 32) { // space char
              lineIndent++
            } else {
              break
            }
          }

          if (lineIndent >= indent) {
            currentItem.lines.push(line.substring(indent))
          } else if (lineIndent >= baseIndentLen + 2) {
            currentItem.lines.push(line.substring(baseIndentLen + 2))
          } else {
            currentItem.lines.push(trimmed)
          }
        }
      }
    }

    if (currentItem) {
      items.push(this.processListItem(currentItem, isLoose))
    }

    return items
  }

  /**
   * Process a single list item, parsing its content as blocks
   * Phase 3: Enhanced to handle mixed nested lists by splitting at list boundaries
   * Phase 4: Added support for task list checkboxes (GFM extension)
   * Phase 6: Optimized for performance (reduced string operations, smarter detection)
   */
  private processListItem(
    item: { text: string; lines: string[]; bulletLength?: number; task?: boolean; checked?: boolean },
    isLoose: boolean
  ): ListItemToken {
    // Optimized: join lines only once, use pre-trimmed content
    const linesLen = item.lines.length
    if (linesLen === 0 || (linesLen === 1 && !item.lines[0])) {
      return {
        text: item.text,
        tokens: [],
        loose: isLoose,
        task: item.task,
        checked: item.checked,
      }
    }

    // Fast path: single line items (very common)
    if (linesLen === 1) {
      const content = item.lines[0].trim()
      if (!content) {
        return {
          text: item.text,
          tokens: [],
          loose: isLoose,
          task: item.task,
          checked: item.checked,
        }
      }
      // Single line, just parse inline content (no block tokenization needed)
      return {
        text: item.text,
        tokens: this.tokenize(content),
        loose: isLoose,
        task: item.task,
        checked: item.checked,
      }
    }

    // Optimized: pre-compile regex and check for nested lists in one pass
    // Only split lines if we actually find a nested list marker
    const listMarkerRegex = /^( {0,3})([*+-]|\d{1,9}[.)]) /
    let hasNestedList = false

    // Check only from line 1 onwards (line 0 is item text, can't be a nested list)
    for (let i = 1; i < linesLen; i++) {
      const line = item.lines[i]
      if (line && listMarkerRegex.test(line)) {
        hasNestedList = true
        break
      }
    }

    // Fast path: no nested lists (most common case)
    if (!hasNestedList) {
      const content = item.lines.join('\n').trim()
      return {
        text: item.text,
        tokens: this.tokenize(content),
        loose: isLoose,
        task: item.task,
        checked: item.checked,
      }
    }

    // Slow path: has nested lists, need to split at boundaries
    // Optimized: use arrays and join once at end
    const blocks: string[] = []
    let currentBlock: string[] = []
    let inList = false

    for (let i = 0; i < linesLen; i++) {
      const line = item.lines[i]
      const isListLine = listMarkerRegex.test(line)

      if (currentBlock.length === 0) {
        currentBlock.push(line)
        inList = isListLine
      } else if (isListLine === inList) {
        currentBlock.push(line)
      } else {
        blocks.push(currentBlock.join('\n'))
        currentBlock = [line]
        inList = isListLine
      }
    }

    if (currentBlock.length > 0) {
      blocks.push(currentBlock.join('\n'))
    }

    // Tokenize each block
    const tokens: BlockToken[] = []
    for (let i = 0; i < blocks.length; i++) {
      const blockTokens = this.tokenize(blocks[i])
      tokens.push(...blockTokens)
    }

    return {
      text: item.text,
      tokens,
      loose: isLoose,
      task: item.task,
      checked: item.checked,
    }
  }

  /**
   * Tokenize table (GFM extension - Phase 4)
   * Only active when gfm option is not false
   */
  private tokenizeTable(src: string): { token: BlockToken; raw: string } | null {
    if (this.options.gfm === false) return null

    const match = PATTERNS.table.exec(src)
    if (!match) return null

    const raw = match[0]
    const headerLine = match[1]
    const delimiterLine = match[2]
    const bodyLines = match[3] || ''

    // Parse alignment from delimiter row first
    const align = this.parseTableAlignment(delimiterLine)

    // Must have at least one column
    if (align.length === 0) {
      return null
    }

    // Parse header cells
    const headerCells = this.parseTableRow(headerLine)

    // Pad or trim header to match alignment column count
    while (headerCells.length < align.length) {
      headerCells.push({ text: '', tokens: [] })
    }
    if (headerCells.length > align.length) {
      headerCells.splice(align.length)
    }

    // Parse body rows
    const rows: TableCell[][] = []
    if (bodyLines.trim()) {
      const bodyRowLines = bodyLines.trim().split('\n')
      for (const line of bodyRowLines) {
        if (line.includes('|')) {
          const cells = this.parseTableRow(line)
          // Pad or trim to match column count
          while (cells.length < align.length) {
            cells.push({ text: '', tokens: [] })
          }
          if (cells.length > align.length) {
            cells.splice(align.length)
          }
          rows.push(cells)
        }
      }
    }

    return {
      token: {
        type: 'table',
        raw,
        header: headerCells,
        align,
        rows,
      },
      raw,
    }
  }

  /**
   * Parse a table row into cells
   */
  private parseTableRow(line: string): TableCell[] {
    // Remove leading/trailing pipes and split
    const trimmed = line.trim().replace(/^\||\|$/g, '')
    const cellTexts = trimmed.split('|').map((cell) => cell.trim())

    return cellTexts.map((text) => ({
      text,
      tokens: [], // Will be filled by inline parser
    }))
  }

  /**
   * Parse table alignment from delimiter row
   */
  private parseTableAlignment(line: string): Array<'left' | 'center' | 'right' | null> {
    const trimmed = line.trim().replace(/^\||\|$/g, '')
    const delimiters = trimmed.split('|').map((d) => d.trim())

    return delimiters.map((delimiter) => {
      const hasLeft = delimiter.startsWith(':')
      const hasRight = delimiter.endsWith(':')

      if (hasLeft && hasRight) {
        return 'center'
      }
      if (hasRight) {
        return 'right'
      }
      if (hasLeft) {
        return 'left'
      }
      return null
    })
  }

  /**
   * Tokenize HTML block
   */
  private tokenizeHtml(src: string): { token: BlockToken; raw: string } | null {
    if (!this.options.allowHtml) return null

    const match = PATTERNS.html.exec(src)
    if (!match) return null

    const raw = match[0]
    const text = raw.trim()

    return {
      token: {
        type: 'html',
        raw,
        text,
      },
      raw,
    }
  }

  /**
   * Tokenize paragraph (fallback)
   */
  private tokenizeParagraph(src: string): { token: BlockToken; raw: string } | null {
    const match = PATTERNS.paragraph.exec(src)
    if (!match) return null

    const raw = match[0]
    const text = match[1].trim()

    // Skip empty paragraphs
    if (!text) return null

    return {
      token: {
        type: 'paragraph',
        raw,
        text,
        tokens: [], // Will be filled by inline parser
      },
      raw,
    }
  }
}
