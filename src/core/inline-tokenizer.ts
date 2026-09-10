/**
 * Inline tokenizer for parsing inline markdown elements
 */

import type { InlineRule, InlineToken, LinkReference } from './types.js'
import { consumeTokenBudget, type TokenBudget } from './token-budget.js'
import { delimiterFlags, resolveEmphasis, type EmphasisDelimiter } from './emphasis.js'
import { htmlTagEnd } from '../utils/html-syntax.js'
import { decodeEntities, decodeMarkdown, normalizeDestination } from '../utils/markdown-text.js'
import {
  gfmInlineSupport,
  type GfmInlineSupport,
} from '../inline/gfm-support.js'

/**
 * Inline regex patterns
 */
const PATTERNS = {
  // Escape (backslash)
  escape: /^\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/,

  // CommonMark angle autolinks: <scheme:destination> and <name@example.com>
  angleUri: /^<([A-Za-z][A-Za-z\d+.-]{1,31}:[^<>\x00-\x20]*)>/,
  angleEmail: /^<([A-Za-z\d.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z\d](?:[A-Za-z\d-]{0,61}[A-Za-z\d])?(?:\.[A-Za-z\d](?:[A-Za-z\d-]{0,61}[A-Za-z\d])?)*)>/,

  // Line break (two spaces + newline)
  br: /^ {2,}\n(?!\s*$)/,

  // Plain text (everything else)
  // Phase 6: Keep negative lookahead for autolinks (necessary for correct parsing)
  text: /^[^*_`[<\n\\!~]+/,
}

const INLINE_RULE_PRIORITIES: Readonly<Record<string, number>> = {
  escape: 1000,
  code: 900,
  strong: 800,
  em: 700,
  del: 650,
  link: 600,
  angleAutolink: 575,
  html: 550,
  br: 500,
  autolink: 400,
  text: 0,
}
const DEFAULT_CUSTOM_PRIORITY = 750
const HARD_MAX_INLINE_NESTING_DEPTH = 32
const MIN_INLINE_WORK_BUDGET = 10_000

type InlineResult = { token: InlineToken; raw: string; delimiter?: Omit<EmphasisDelimiter, 'index'> }

interface ParsedLinkDestination {
  end: number
  href: string
  title?: string
}

interface DelimiterRun {
  start: number
  length: number
}

interface InlineWorkBudget {
  remaining: number
}

interface LinkScan {
  closingBrackets: number[]
  matchingBrackets: Map<number, number>
  openingAngles: number[]
  closingAngles: number[]
  whitespaces: number[]
  doubleQuotes: number[]
  singleQuotes: number[]
  matchingParentheses: Map<number, number>
  parenthesisBalance: Int32Array
  destinations: Map<number, ParsedLinkDestination | null>
  tildeClosers: number[][]
  emailLinks: Map<number, InlineResult>
  emailStarts: number[]
  backtickRuns: DelimiterRun[]
  backtickClosers: Map<number, DelimiterRun[]>
  htmlClosingAngles: number[]
  htmlComments: number[]
  htmlInstructions: number[]
  htmlCdata: number[]
  lineBreaks: number[]
  lastNonWhitespace: number
}

interface ResolvedInlineRule {
  rule: InlineRule
  priority: number
  order: number
}

/**
 * Options for inline tokenizer
 */
export interface InlineTokenizerOptions {
  /** When true, bare newlines produce <br> (GFM-style line breaks) */
  breaks?: boolean
  /** When false, skip strikethrough and autolink parsing */
  gfm?: boolean
  /** When true, preserve raw inline HTML tokens. */
  allowHtml?: boolean
}

/**
 * Inline tokenizer class
 */
/** Internal tokenizer implementation with injectable optional syntax support. */
export class InlineTokenizerBase {
  /** Custom inline rules indexed by trigger char code */
  private customCharMap: Map<number, ResolvedInlineRule[]>
  /** Custom inline rules without trigger chars (checked as fallback) */
  private customGeneralRules: ResolvedInlineRule[]
  /** Text pattern adapted for custom rule trigger chars */
  private textPattern: RegExp
  /** Inline tokenizer options */
  private inlineOptions: InlineTokenizerOptions
  /** Optional GFM-only tokenizer implementation. */
  private gfmSupport?: GfmInlineSupport

  constructor(
    customRules: InlineRule[] = [],
    options: InlineTokenizerOptions = {},
    gfmSupport?: GfmInlineSupport
  ) {
    this.inlineOptions = options
    this.gfmSupport = options.gfm === true ? gfmSupport : undefined
    this.customCharMap = new Map()
    this.customGeneralRules = []

    const triggerCharSet = new Set<number>()
    let hasGeneralRules = false

    for (const [order, rule] of customRules.entries()) {
      const resolved = {
        rule,
        priority: this.resolveRulePriority(rule),
        order,
      }
      if (rule.triggerChars && rule.triggerChars.length > 0) {
        for (const charCode of rule.triggerChars) {
          triggerCharSet.add(charCode)
          const existing = this.customCharMap.get(charCode)
          if (existing) {
            existing.push(resolved)
          } else {
            this.customCharMap.set(charCode, [resolved])
          }
        }
      } else {
        hasGeneralRules = true
        this.customGeneralRules.push(resolved)
      }
    }

    const byPriority = (left: ResolvedInlineRule, right: ResolvedInlineRule): number => (
      right.priority - left.priority || left.order - right.order
    )
    this.customGeneralRules.sort(byPriority)
    for (const [charCode, rules] of this.customCharMap) {
      rules.sort(byPriority)
      if (this.customGeneralRules.length > 0) {
        this.customCharMap.set(
          charCode,
          [...rules, ...this.customGeneralRules].sort(byPriority)
        )
      }
    }

    const extra = [...triggerCharSet].map(code => `\\u${code.toString(16).padStart(4, '0')}`).join('')
    this.textPattern = this.gfmSupport
      ? this.gfmSupport.textPattern(extra, hasGeneralRules)
      : extra || hasGeneralRules
        ? new RegExp(`^[^*_\`[<\\n\\\\!~${extra}]${hasGeneralRules ? '' : '+'}`)
        : PATTERNS.text
  }

  /**
   * Tokenize inline markdown string
   * Phase 6: Optimized with fast-path checks to avoid unnecessary regex execution
   *
   * @param src - Inline markdown source
   * @returns Array of inline tokens
   */
  tokenize(
    src: string,
    references: ReadonlyMap<string, LinkReference> = new Map(),
    tokenBudget?: TokenBudget
  ): InlineToken[] {
    return this.tokenizeInternal(src, references, 0, {
      remaining: Math.max(MIN_INLINE_WORK_BUDGET, src.length * 2),
    }, tokenBudget)
  }

  private tokenizeInternal(
    src: string,
    references: ReadonlyMap<string, LinkReference>,
    depth: number,
    workBudget: InlineWorkBudget,
    tokenBudget?: TokenBudget,
    allowExtendedAutolinks = true
  ): InlineToken[] {
    if (depth >= HARD_MAX_INLINE_NESTING_DEPTH || workBudget.remaining < src.length) {
      if (src) consumeTokenBudget(tokenBudget)
      return src ? [{ type: 'text', raw: src, text: src }] : []
    }
    workBudget.remaining -= src.length

    // A complete plain-text match needs no delimiter or link indexes. Custom
    // rules still run through normal priority dispatch, even without triggers.
    if (src && this.customCharMap.size === 0 && this.customGeneralRules.length === 0) {
      const plain = this.textPattern.exec(src)
      if (plain?.[0].length === src.length && !(this.gfmSupport && src.includes('@'))) {
        consumeTokenBudget(tokenBudget)
        return [{ type: 'text', raw: src, text: decodeEntities(src) }]
      }
    }

    const tokens: InlineToken[] = []
    const delimiters: EmphasisDelimiter[] = []
    const linkScan = this.createLinkScan(src, allowExtendedAutolinks)
    let cursor = 0
    let previousChar = ''
    let fallbackTextIndex = -1

    while (cursor < src.length) {
      const char = src.charCodeAt(cursor)
      const token = this.tokenizeAt(
        src,
        cursor,
        char,
        references,
        previousChar,
        linkScan,
        depth,
        workBudget,
        tokenBudget,
        allowExtendedAutolinks
      )

      if (char === 10) {
        const previous = tokens.at(-1)
        if (previous?.type === 'text') {
          const spaces = /[ \t]+$/.exec(previous.raw)?.[0] ?? ''
          if (spaces) {
            previous.raw = previous.raw.slice(0, -spaces.length)
            previous.text = previous.text.slice(0, -spaces.length)
            if (/^ {2,}$/.test(spaces)) {
              consumeTokenBudget(tokenBudget)
              tokens.push({ type: 'br', raw: spaces + '\n' })
              previousChar = '\n'; cursor++; fallbackTextIndex = -1; continue
            }
          }
        }
      }
      if (token) {
        this.assertProgress('inline tokenizer', src, cursor, token.raw)
        if (token.token.type !== 'text') consumeTokenBudget(tokenBudget)
        if (token.delimiter) delimiters.push({ ...token.delimiter, index: tokens.length })
        tokens.push(token.token)
        fallbackTextIndex = -1
        previousChar = token.raw.at(-1) ?? previousChar
        cursor += token.raw.length
      } else {
        if (
          char === 91
          && this.customCharMap.size === 0
          && this.customGeneralRules.length === 0
          && this.findPosition(linkScan.closingBrackets, cursor + 1) === -1
        ) {
          let end = cursor + 1
          while (src.charCodeAt(end) === 91) end++
          const raw = src.slice(cursor, end)
          tokens.push({ type: 'text', raw, text: raw })
          fallbackTextIndex = tokens.length - 1
          previousChar = '['
          cursor = end
          continue
        }

        if (
          (char === 33 || char === 60)
          && this.customCharMap.size === 0
          && this.customGeneralRules.length === 0
        ) {
          let end = cursor + 1
          while (src.charCodeAt(end) === char) end++
          const preserveLast = (
            (char === 33 && src.charCodeAt(end) === 91)
            || (char === 60 && end < src.length)
          )
          if (preserveLast) end--
          if (end > cursor) {
            const raw = src.slice(cursor, end)
            fallbackTextIndex = this.appendFallbackText(
              tokens,
              fallbackTextIndex,
              raw,
              tokenBudget
            )
            previousChar = raw.at(-1) ?? previousChar
            cursor = end
            continue
          }
        }

        fallbackTextIndex = this.appendFallbackText(
          tokens,
          fallbackTextIndex,
          src[cursor],
          tokenBudget
        )
        previousChar = src[cursor]
        cursor++
      }
    }

    return resolveEmphasis(tokens, delimiters, src, tokenBudget, HARD_MAX_INLINE_NESTING_DEPTH - depth)
  }

  private appendFallbackText(
    tokens: InlineToken[],
    fallbackTextIndex: number,
    raw: string,
    _tokenBudget?: TokenBudget
  ): number {
    const previous = tokens[fallbackTextIndex]
    if (fallbackTextIndex === tokens.length - 1 && previous?.type === 'text') {
      previous.raw += raw
      previous.text += raw
      return fallbackTextIndex
    }
    tokens.push({ type: 'text', raw, text: raw })
    return tokens.length - 1
  }

  private resolveRulePriority(rule: InlineRule): number {
    if (rule.priority === undefined) return DEFAULT_CUSTOM_PRIORITY
    if (typeof rule.priority === 'number') {
      return Number.isFinite(rule.priority) ? rule.priority : DEFAULT_CUSTOM_PRIORITY
    }

    const separator = rule.priority.indexOf(':')
    const position = rule.priority.slice(0, separator)
    const targetName = rule.priority.slice(separator + 1)
    const target = INLINE_RULE_PRIORITIES[targetName]
    if (target === undefined) return DEFAULT_CUSTOM_PRIORITY
    return position === 'before' ? target + 1 : target - 1
  }

  private tokenizeAt(
    source: string,
    cursor: number,
    char: number,
    references: ReadonlyMap<string, LinkReference>,
    _previousChar: string,
    linkScan: LinkScan,
    depth: number,
    workBudget: InlineWorkBudget,
    tokenBudget?: TokenBudget,
    allowExtendedAutolinks = true
  ): InlineResult | null {
    const customRules = this.getCustomRules(char)
    let customIndex = 0
    let remaining: string | undefined
    const src = (): string => (remaining ??= source.slice(cursor))

    const tryCustomBefore = (priority: number): InlineResult | null => {
      while (customIndex < customRules.length && customRules[customIndex].priority > priority) {
        const candidate = customRules[customIndex++]
        const result = candidate.rule.tokenize(src())
        if (result) {
          this.assertProgress(candidate.rule.name, source, cursor, result.raw)
          return result
        }
      }
      return null
    }

    const tryBuiltin = (priority: number, tokenize: () => InlineResult | null): InlineResult | null => (
      tryCustomBefore(priority) || tokenize()
    )

    let result: InlineResult | null = null

    if (allowExtendedAutolinks && linkScan.emailLinks.has(cursor)) {
      result = tryBuiltin(INLINE_RULE_PRIORITIES['autolink'], () => {
        consumeTokenBudget(tokenBudget)
        return linkScan.emailLinks.get(cursor)!
      })
      if (result) return result
    }

    if (char === 92) {
      result = tryBuiltin(INLINE_RULE_PRIORITIES['escape'], () => this.tokenizeEscape(src()))
    } else if (char === 96) {
      result = tryBuiltin(
        INLINE_RULE_PRIORITIES['code'],
        () => this.tokenizeCode(source, cursor, linkScan)
      )
    } else if (char === 42 || char === 95) {
      let end = cursor + 1
      while (source.charCodeAt(end) === char) end++
      const priority = end - cursor >= 2 ? INLINE_RULE_PRIORITIES['strong'] : INLINE_RULE_PRIORITIES['em']
      result = tryBuiltin(priority, () => {
        const raw = source.slice(cursor, end)
        return { token: { type: 'text', raw, text: raw }, raw,
          delimiter: { start: cursor, length: raw.length, char: raw[0], ...delimiterFlags(source, cursor, raw.length) } }
      })
    } else if (char === 126 && this.gfmSupport) {
      result = tryBuiltin(
        INLINE_RULE_PRIORITIES['del'],
        () => this.gfmSupport!.tokenizeDelete(source, cursor, linkScan.tildeClosers,
          text => this.tokenizeInternal(text, references, depth + 1, workBudget, tokenBudget, allowExtendedAutolinks))
      )
    } else if (char === 33 || char === 91) {
      result = tryBuiltin(
        INLINE_RULE_PRIORITIES['link'],
        () => this.tokenizeLink(
          source, cursor, references, linkScan, depth, workBudget, tokenBudget
        )
      )
    } else if (char === 60) {
      result = tryBuiltin(
        INLINE_RULE_PRIORITIES['angleAutolink'],
        () => this.tokenizeAngleAutolink(src(), tokenBudget)
      )
      if (!result && this.inlineOptions.allowHtml) {
        result = tryBuiltin(
          INLINE_RULE_PRIORITIES['html'],
          () => this.tokenizeHtml(source, cursor, linkScan)
        )
      }
    } else if (
      (char === 32 && source.charCodeAt(cursor + 1) === 32)
      || (char === 10 && this.inlineOptions.breaks)
    ) {
      result = tryBuiltin(
        INLINE_RULE_PRIORITIES['br'],
        () => this.tokenizeBr(source, cursor, linkScan)
      )
    }
    if (result) return result

    if (
      allowExtendedAutolinks && this.gfmSupport?.isAutolinkStart(char)
    ) {
      result = tryBuiltin(
        INLINE_RULE_PRIORITIES['autolink'],
        () => {
          const autolink = this.gfmSupport?.tokenizeAutolink(src()) ?? null
          if (autolink) consumeTokenBudget(tokenBudget)
          return autolink
        }
      )
      if (result) return result
    }

    if (!'*_`[<\n\\!~'.includes(source[cursor])) {
      result = tryBuiltin(INLINE_RULE_PRIORITIES['text'], () => {
        const nextEmail = this.findPosition(linkScan.emailStarts, cursor + 1)
        return this.tokenizeText(nextEmail < 0 ? src() : source.slice(cursor, nextEmail))
      })
      if (result) return result
    } else {
      result = tryCustomBefore(INLINE_RULE_PRIORITIES['text'])
      if (result) return result
    }

    while (customIndex < customRules.length) {
      const candidate = customRules[customIndex++]
      result = candidate.rule.tokenize(src())
      if (result) {
        this.assertProgress(candidate.rule.name, source, cursor, result.raw)
        return result
      }
    }
    return null
  }

  private getCustomRules(char: number): ResolvedInlineRule[] {
    const charRules = this.customCharMap.get(char) ?? []
    if (charRules.length === 0) return this.customGeneralRules
    return charRules
  }

  private assertProgress(ruleName: string, src: string, cursor: number, raw: string): void {
    if (typeof raw !== 'string' || raw.length === 0) {
      throw new TypeError(`Inline rule "${ruleName}" must consume a non-empty prefix`)
    }
    if (!src.startsWith(raw, cursor)) {
      throw new TypeError(`Inline rule "${ruleName}" returned raw text that is not a source prefix`)
    }
  }

  private createLinkScan(src: string, allowExtendedAutolinks: boolean): LinkScan {
    const closingBrackets: number[] = []
    const matchingBrackets = new Map<number, number>()
    const bracketStack: number[] = []
    let protectedUntil = 0
    const openingAngles: number[] = []
    const closingAngles: number[] = []
    const whitespaces: number[] = []
    const doubleQuotes: number[] = []
    const singleQuotes: number[] = []
    const matchingParentheses = new Map<number, number>()
    const parenthesisStack: number[] = []
    const tildeClosers: number[][] = [[], [], []]
    const emailLinks = (allowExtendedAutolinks ? this.gfmSupport?.emailLinks(src) : undefined) ?? new Map<number, InlineResult>()
    const emailStarts = [...emailLinks.keys()]
    const backtickRuns: DelimiterRun[] = []
    const backtickClosers = new Map<number, DelimiterRun[]>()
    const htmlClosingAngles: number[] = []
    const htmlComments: number[] = []
    const htmlInstructions: number[] = []
    const htmlCdata: number[] = []
    if (this.inlineOptions.allowHtml) {
      for (let index = 0; index < src.length; index++) {
        if (src[index] !== '>') continue
        htmlClosingAngles.push(index)
        if (src.slice(index - 2, index) === '--') htmlComments.push(index - 2)
        if (src[index - 1] === '?') htmlInstructions.push(index - 1)
        if (src.slice(index - 2, index) === ']]') htmlCdata.push(index - 2)
      }
    }
    const lineBreaks: number[] = []
    let lastNonWhitespace = -1
    let parenthesisBalance = new Int32Array(0)
    let trackDirectSyntax = false
    let escaped = false

    for (let index = 0; index < src.length; index++) {
      if (src[index] === '`') {
        this.indexBacktickRun(src, index, backtickRuns, backtickClosers)
        index += backtickRuns.at(-1)!.length - 1
      }
    }
    for (let index = 0; index < src.length; index++) {
      const char = src.charCodeAt(index)
      if (this.inlineOptions.breaks && !/\s/.test(src[index])) lastNonWhitespace = index
      if (this.inlineOptions.allowHtml) {
        if (char === 10) lineBreaks.push(index)
      }
      if (trackDirectSyntax) {
        parenthesisBalance[index + 1] = parenthesisBalance[index]
      }

      if (trackDirectSyntax && InlineTokenizerBase.isWhitespace(char)) {
        whitespaces.push(index)
      }

      if (escaped) {
        escaped = false
      } else if (char === 92) {
        escaped = true
      } else {
        if (index >= protectedUntil) {
          const tildeLength = this.gfmSupport?.isTildeCloser(src, index) ?? 0
          if (tildeLength) tildeClosers[tildeLength].push(index)
          if (char === 96) {
            const run = this.findContainingDelimiterRun(backtickRuns, index)!
            const length = run.start + run.length - index
            const close = this.findDelimiterRun(backtickClosers.get(length) ?? [], run.start + run.length + 1)
            protectedUntil = close ? close.start + close.length : run.start + run.length
          } else if (char === 60) {
            const angle = PATTERNS.angleUri.exec(src.slice(index)) ?? PATTERNS.angleEmail.exec(src.slice(index))
            const tag = this.inlineOptions.allowHtml ? this.tokenizeHtml(src, index, { htmlClosingAngles, htmlComments, htmlInstructions, htmlCdata, lineBreaks } as LinkScan) : null
            protectedUntil = index + (angle?.[0].length ?? tag?.raw.length ?? 0)
          } else if (char === 91) bracketStack.push(index)
          else if (char === 93) {
            const open = bracketStack.pop()
            if (open !== undefined) matchingBrackets.set(open, index)
          }
        }
        if (char === 93) {
          if (index >= protectedUntil) closingBrackets.push(index)
          if (!trackDirectSyntax && src.charCodeAt(index + 1) === 40) {
            trackDirectSyntax = true
            parenthesisBalance = new Int32Array(src.length + 1)
          }
        } else if (trackDirectSyntax && char === 60) openingAngles.push(index)
        else if (trackDirectSyntax && char === 62) closingAngles.push(index)
        else if (trackDirectSyntax && char === 34) doubleQuotes.push(index)
        else if (trackDirectSyntax && char === 39) singleQuotes.push(index)
        else if (trackDirectSyntax && char === 40) {
          parenthesisStack.push(index)
          parenthesisBalance[index + 1]++
        } else if (trackDirectSyntax && char === 41) {
          const opening = parenthesisStack.pop()
          if (opening !== undefined) matchingParentheses.set(opening, index)
          parenthesisBalance[index + 1]--
        }
      }
    }

    return {
      closingBrackets,
      matchingBrackets,
      openingAngles,
      closingAngles,
      whitespaces,
      doubleQuotes,
      singleQuotes,
      matchingParentheses,
      parenthesisBalance,
      destinations: new Map(),
      tildeClosers,
      emailLinks,
      emailStarts,
      backtickRuns,
      backtickClosers,
      htmlClosingAngles,
      htmlComments,
      htmlInstructions,
      htmlCdata,
      lineBreaks,
      lastNonWhitespace,
    }
  }

  private indexBacktickRun(
    src: string,
    start: number,
    runs: DelimiterRun[],
    runsByLength: Map<number, DelimiterRun[]>
  ): void {
    let end = start + 1
    while (src.charCodeAt(end) === 96) end++
    const run = { start, length: end - start }
    runs.push(run)

    const matchingLength = runsByLength.get(run.length)
    if (matchingLength) matchingLength.push(run)
    else runsByLength.set(run.length, [run])
  }

  private findPosition(positions: number[], minimum: number): number {
    let low = 0
    let high = positions.length

    while (low < high) {
      const middle = low + Math.floor((high - low) / 2)
      if (positions[middle] < minimum) low = middle + 1
      else high = middle
    }

    return positions[low] ?? -1
  }

  private findDelimiterRun(runs: DelimiterRun[], minimum: number): DelimiterRun | null {
    let low = 0
    let high = runs.length

    while (low < high) {
      const middle = low + Math.floor((high - low) / 2)
      if (runs[middle].start < minimum) low = middle + 1
      else high = middle
    }

    return runs[low] ?? null
  }

  private findContainingDelimiterRun(
    runs: DelimiterRun[],
    position: number
  ): DelimiterRun | null {
    let low = 0
    let high = runs.length

    while (low < high) {
      const middle = low + Math.floor((high - low) / 2)
      if (runs[middle].start <= position) low = middle + 1
      else high = middle
    }

    const run = runs[low - 1]
    return run && run.start + run.length > position ? run : null
  }

  /**
   * Tokenize escape sequence
   */
  private tokenizeEscape(src: string): { token: InlineToken; raw: string } | null {
    if (src.startsWith('\\\n')) return { token: { type: 'br', raw: '\\\n' }, raw: '\\\n' }
    const match = PATTERNS.escape.exec(src)
    if (!match) return null

    const raw = match[0]
    const text = match[1]

    return {
      token: {
        type: 'text',
        raw,
        text,
      },
      raw,
    }
  }

  /**
   * Tokenize inline code
   */
  private tokenizeCode(
    source: string,
    cursor: number,
    linkScan: LinkScan
  ): { token: InlineToken; raw: string } | null {
    const openingRun = this.findContainingDelimiterRun(linkScan.backtickRuns, cursor)
    if (!openingRun) return null

    const delimiterLength = openingRun.start + openingRun.length - cursor
    const matchingRuns = linkScan.backtickClosers.get(delimiterLength) ?? []
    const closingRun = this.findDelimiterRun(
      matchingRuns,
      openingRun.start + openingRun.length + 1
    )
    if (!closingRun) {
      const raw = source.slice(cursor, openingRun.start + openingRun.length)
      return { token: { type: 'text', raw, text: raw }, raw }
    }

    const raw = source.slice(cursor, closingRun.start + delimiterLength)
    let text = source
      .slice(openingRun.start + openingRun.length, closingRun.start)
      .replace(/\r?\n/g, ' ')
    if (text.startsWith(' ') && text.endsWith(' ') && /[^ ]/.test(text)) {
      text = text.slice(1, -1)
    }

    return {
      token: {
        type: 'code',
        raw,
        text,
      },
      raw,
    }
  }

  /** Tokenize CommonMark URI and email autolinks enclosed in angle brackets. */
  private tokenizeAngleAutolink(
    src: string,
    tokenBudget?: TokenBudget
  ): InlineResult | null {
    const uri = PATTERNS.angleUri.exec(src)
    const email = uri ? null : PATTERNS.angleEmail.exec(src)
    const match = uri ?? email
    if (!match) return null

    const raw = match[0]
    const text = match[1]
    let href = email ? `mailto:${text}` : text
    if (!email) {
      try {
        href = encodeURI(href)
      } catch {
        // A lone surrogate cannot be URI-encoded. The renderer still escapes it.
      }
    }

    consumeTokenBudget(tokenBudget)
    return {
      token: {
        type: 'link',
        raw,
        href,
        text,
        tokens: [{ type: 'text', raw: text, text }],
      },
      raw,
    }
  }

  /**
   * Tokenize link or image
   */
  private tokenizeLink(
    src: string,
    cursor: number,
    references: ReadonlyMap<string, LinkReference>,
    linkScan: LinkScan,
    depth: number,
    workBudget: InlineWorkBudget,
    tokenBudget?: TokenBudget
  ): { token: InlineToken; raw: string } | null {
    const isImage = src.charCodeAt(cursor) === 33
    const openBracket = cursor + (isImage ? 1 : 0)
    if (src.charCodeAt(openBracket) !== 91) return null

    const closingBracket = linkScan.matchingBrackets.get(openBracket) ?? -1
    if (closingBracket === -1) return null

    const text = src.slice(openBracket + 1, closingBracket)
    if (src.charCodeAt(closingBracket + 1) !== 40) {
      return this.tokenizeReferenceLink(
        src,
        cursor,
        closingBracket,
        text,
        isImage,
        references,
        linkScan,
        depth,
        workBudget,
        tokenBudget
      )
    }

    let destination = linkScan.destinations.get(closingBracket)
    if (destination === undefined) {
      destination = this.parseLinkDestination(src, closingBracket + 2, linkScan)
      linkScan.destinations.set(closingBracket, destination)
    }
    if (!destination) return this.tokenizeReferenceLink(
      src, cursor, closingBracket, text, isImage, references, linkScan, depth, workBudget, tokenBudget
    )

    const raw = src.slice(cursor, destination.end)
    const { href, title } = destination

    if (isImage) {
      const children = this.tokenizeInternal(text, references, depth + 1, workBudget, tokenBudget)
      return {
        token: {
          type: 'image',
          raw,
          href,
          title,
          text: this.inlineText(children),
        },
        raw,
      }
    }

    // Recursively tokenize link text
    const tokens = this.tokenizeInternal(
      text, references, depth + 1, workBudget, tokenBudget, false
    )

    if (this.containsLink(tokens)) return null
    return {
      token: {
        type: 'link',
        raw,
        href,
        title,
        text,
        tokens,
      },
      raw,
    }
  }

  private tokenizeReferenceLink(
    src: string,
    cursor: number,
    closingBracket: number,
    text: string,
    isImage: boolean,
    references: ReadonlyMap<string, LinkReference>,
    linkScan: LinkScan,
    depth: number,
    workBudget: InlineWorkBudget,
    tokenBudget?: TokenBudget
  ): { token: InlineToken; raw: string } | null {
    if (!text || text.length > 999) return null

    let end = closingBracket + 1
    let label = text
    if (src.charCodeAt(end) === 91) {
      const explicitClosingBracket = linkScan.matchingBrackets.get(end) ?? -1
      if (explicitClosingBracket === -1) return null

      const explicitLabel = src.slice(end + 1, explicitClosingBracket)
      if (explicitLabel.length > 999 || /(^|[^\\])\[/.test(explicitLabel)) return null
      if (explicitLabel) label = explicitLabel
      end = explicitClosingBracket + 1
    }

    const reference = references.get(InlineTokenizerBase.normalizeReferenceLabel(label))
    if (!reference) return null

    const raw = src.slice(cursor, end)
    if (isImage) {
      return {
        token: { type: 'image', raw, text: this.inlineText(this.tokenizeInternal(text, references, depth + 1, workBudget, tokenBudget)), href: reference.href, title: reference.title },
        raw,
      }
    }

    const tokens = this.tokenizeInternal(text, references, depth + 1, workBudget, tokenBudget, false)
    if (this.containsLink(tokens)) return null
    return {
      token: {
        type: 'link',
        raw,
        text,
        href: reference.href,
        title: reference.title,
        tokens,
      },
      raw,
    }
  }

  private containsLink(tokens: InlineToken[]): boolean {
    return tokens.some(token => token.type === 'link' || ('tokens' in token && this.containsLink(token.tokens)))
  }

  private inlineText(tokens: InlineToken[]): string {
    return tokens.map(token => 'tokens' in token ? this.inlineText(token.tokens) : token.type === 'br' ? '\n' : token.text).join('')
  }

  private parseLinkDestination(
    src: string,
    start: number,
    linkScan: LinkScan
  ): ParsedLinkDestination | null {
    let cursor = start
    while (InlineTokenizerBase.isWhitespace(src.charCodeAt(cursor))) cursor++
    const destinationStart = cursor
    let href = ''

    if (src.charCodeAt(cursor) === 60) {
      const hrefStart = cursor + 1
      const hrefEnd = this.findPosition(linkScan.closingAngles, hrefStart)
      if (hrefEnd === -1) return null

      const nestedOpening = this.findPosition(linkScan.openingAngles, hrefStart)
      if (nestedOpening !== -1 && nestedOpening < hrefEnd) return null

      if (src.slice(hrefStart, hrefEnd).includes('\n')) return null

      href = src.slice(hrefStart, hrefEnd)
      cursor = hrefEnd + 1
    } else {
      const outerOpening = start - 1
      const outerClosing = linkScan.matchingParentheses.get(outerOpening)
      const whitespace = this.findPosition(linkScan.whitespaces, destinationStart)

      if (
        outerClosing !== undefined
        && (whitespace === -1 || outerClosing < whitespace)
      ) {
        href = normalizeDestination(src.slice(destinationStart, outerClosing))
        return { end: outerClosing + 1, href }
      }

      if (whitespace === -1) return null
      const balance = (
        linkScan.parenthesisBalance[whitespace]
        - linkScan.parenthesisBalance[destinationStart]
      )
      if (balance !== 0) return null

      href = src.slice(destinationStart, whitespace)
      cursor = whitespace
    }

    href = normalizeDestination(href)
    if (src.charCodeAt(cursor) === 41) return { end: cursor + 1, href }
    if (!InlineTokenizerBase.isWhitespace(src.charCodeAt(cursor))) return null

    while (InlineTokenizerBase.isWhitespace(src.charCodeAt(cursor))) cursor++
    if (src.charCodeAt(cursor) === 41) return { end: cursor + 1, href }

    const titleOpener = src[cursor]
    if (titleOpener !== '"' && titleOpener !== "'" && titleOpener !== '(') return null

    const titleStart = ++cursor
    const titleEnd = titleOpener === '"'
      ? this.findPosition(linkScan.doubleQuotes, titleStart)
      : titleOpener === "'"
        ? this.findPosition(linkScan.singleQuotes, titleStart)
        : linkScan.matchingParentheses.get(titleStart - 1) ?? -1
    if (titleEnd === -1) return null

    const title = decodeMarkdown(src.slice(titleStart, titleEnd))
    cursor = titleEnd + 1
    while (InlineTokenizerBase.isWhitespace(src.charCodeAt(cursor))) cursor++
    if (src.charCodeAt(cursor) !== 41) return null

    return { end: cursor + 1, href, title }
  }

  private static isWhitespace(char: number): boolean {
    return char === 32 || char === 9 || char === 10 || char === 13
  }

  private tokenizeHtml(
    source: string,
    cursor: number,
    linkScan: LinkScan
  ): { token: InlineToken; raw: string } | null {
    let end = -1
    if (source.startsWith('<!--', cursor)) {
      if (source.startsWith('<!-->', cursor)) end = cursor + 5
      else if (source.startsWith('<!--->', cursor)) end = cursor + 6
      else {
        const closing = this.findPosition(linkScan.htmlComments, cursor + 4)
        if (closing >= 0) end = closing + 3
      }
    } else if (source.startsWith('<?', cursor)) {
      const closing = this.findPosition(linkScan.htmlInstructions, cursor + 2)
      if (closing >= 0) end = closing + 2
    } else if (source.startsWith('<![CDATA[', cursor)) {
      const closing = this.findPosition(linkScan.htmlCdata, cursor + 9)
      if (closing >= 0) end = closing + 3
    } else if (/^<![A-Z]+[ \t\n]/.test(source.slice(cursor))) {
      const closing = this.findPosition(linkScan.htmlClosingAngles, cursor + 2)
      if (closing >= 0) end = closing + 1
    } else end = htmlTagEnd(source, cursor)
    if (end < 0) return null

    const raw = source.slice(cursor, end)
    return { token: { type: 'html', raw, text: raw }, raw }
  }

  static normalizeReferenceLabel(label: string): string {
    return label.trim().replace(/\s+/g, ' ').toLowerCase().toUpperCase().toLowerCase()
  }

  /**
   * Tokenize line break
   * Supports both standard (two spaces + newline) and GFM breaks (bare newline)
   */
  private tokenizeBr(
    source: string,
    cursor: number,
    linkScan: LinkScan
  ): { token: InlineToken; raw: string } | null {
    // When breaks: true, a bare newline also produces <br>
    if (this.inlineOptions.breaks && source.charCodeAt(cursor) === 10) { // '\n'
      // Don't match if followed by only whitespace (end of block)
      if (linkScan.lastNonWhitespace <= cursor) return null
      return {
        token: { type: 'br', raw: '\n' },
        raw: '\n',
      }
    }

    const match = PATTERNS.br.exec(source.slice(cursor))
    if (!match) return null

    const raw = match[0]

    return {
      token: {
        type: 'br',
        raw,
      },
      raw,
    }
  }

  /**
   * Tokenize plain text
   * Uses instance textPattern which may exclude custom trigger chars
   */
  private tokenizeText(src: string): { token: InlineToken; raw: string } | null {
    const match = this.textPattern.exec(src)
    if (!match) return null

    const raw = match[0]
    const text = decodeEntities(raw)

    return {
      token: {
        type: 'text',
        raw,
        text,
      },
      raw,
    }
  }
}

/** Public inline tokenizer with GFM support enabled unless `gfm: false`. */
export class InlineTokenizer extends InlineTokenizerBase {
  constructor(customRules: InlineRule[] = [], options: InlineTokenizerOptions = {}) {
    super(customRules, { ...options, gfm: options.gfm !== false }, gfmInlineSupport)
  }
}
