import type {
  BlockRule,
  BlockRuleContext,
  ListItemToken,
  ParserOptions,
} from '../../core/types.js'

const LIST = /^( {0,3})([*+-]|\d{1,9}[.)]) [\s\S]+?(?:\n{2,}(?! )(?!\1(?:[*+-]|\d{1,9}[.)]) )\n*|\s*$)/

interface PendingListItem {
  text: string
  lines: string[]
  bulletLength: number
  task?: boolean
  checked?: boolean
}

function processItem(
  item: PendingListItem,
  loose: boolean,
  context?: BlockRuleContext
): ListItemToken {
  context?.consumeTokens()
  const base = {
    text: item.text,
    loose,
    task: item.task,
    checked: item.checked,
  }
  if (!context || item.lines.length === 0) return { ...base, tokens: [] }

  const nestedDepth = context.depth + 1
  if (item.lines.length === 1) {
    const content = item.lines[0].trim()
    return { ...base, tokens: content ? context.tokenize(content, nestedDepth) : [] }
  }

  const marker = /^( {0,3})([*+-]|\d{1,9}[.)]) /
  const hasNestedList = item.lines.slice(1).some((line) => line && marker.test(line))
  if (!hasNestedList) {
    return {
      ...base,
      tokens: context.tokenize(item.lines.join('\n').trim(), nestedDepth),
    }
  }

  const blocks: string[] = []
  let current: string[] = []
  let inList = false
  for (const line of item.lines) {
    const isListLine = marker.test(line)
    if (current.length === 0 || isListLine === inList) {
      current.push(line)
    } else {
      blocks.push(current.join('\n'))
      current = [line]
    }
    inList = isListLine
  }
  if (current.length > 0) blocks.push(current.join('\n'))

  return {
    ...base,
    tokens: blocks.flatMap((block) => context.tokenize(block, nestedDepth)),
  }
}

function parseItems(
  src: string,
  baseIndent: string,
  ordered: boolean,
  options: Readonly<ParserOptions>,
  context?: BlockRuleContext
): ListItemToken[] {
  const lines = src.split('\n')
  const bullet = ordered ? /^( *)(\d{1,9}[.)]) / : /^( *)([*+-]) /
  const baseIndentLength = baseIndent.length
  const items: ListItemToken[] = []
  let current: PendingListItem | null = null
  let loose = false
  let blank = false

  for (const line of lines) {
    const match = bullet.exec(line)
    if (match && match[1].length === baseIndentLength) {
      if (blank && current) loose = true
      blank = false
      if (current) items.push(processItem(current, loose, context))

      const bulletLength = match[0].length
      const text = line.substring(bulletLength)
      let itemText = text
      let task: boolean | undefined
      let checked: boolean | undefined
      if (options.gfm === true && text.charCodeAt(0) === 91) {
        const taskMatch = /^\[([ xX])\] /.exec(text)
        if (taskMatch) {
          task = true
          checked = taskMatch[1] === 'x' || taskMatch[1] === 'X'
          itemText = text.substring(4)
        }
      }

      current = {
        text: itemText,
        lines: [itemText],
        bulletLength,
        task,
        checked,
      }
      continue
    }

    if (!current) continue
    const trimmed = line.trim()
    if (!trimmed) {
      blank = true
      current.lines.push('')
      continue
    }

    const contentIndent = baseIndentLength + current.bulletLength
    let lineIndent = 0
    while (line.charCodeAt(lineIndent) === 32) lineIndent++
    if (lineIndent >= contentIndent) {
      current.lines.push(line.substring(contentIndent))
    } else if (lineIndent >= baseIndentLength + 2) {
      current.lines.push(line.substring(baseIndentLength + 2))
    } else {
      current.lines.push(trimmed)
    }
  }

  if (current) items.push(processItem(current, loose, context))
  return items
}

/** Ordered and unordered list container rule. */
export const list: BlockRule = {
  name: 'list',
  priority: 600,
  starts: (src) => LIST.test(src),
  tokenize(src, options, context) {
    if (context && context.depth >= context.maxNestingDepth) return null
    const match = LIST.exec(src)
    if (!match) return null
    const raw = match[0]
    const ordered = match[2].length > 1
    const start = ordered ? parseInt(match[2], 10) : undefined
    const items = parseItems(raw, match[1], ordered, options, context)
    return { token: { type: 'list', raw, ordered, start, items }, raw }
  },
}
