/**
 * Inline tokenizer for parsing inline markdown elements
 */

import type { InlineRule, InlineToken, LinkReference } from './types.js'
import { consumeTokenBudget, type TokenBudget } from './token-budget.js'
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

  // Bold/Strong (**text** or __text__)
  // Note: Must be checked before em pattern to take precedence
  strong: /^\*\*(?=\S)([\s\S]*?\S)\*\*(?!\*)|^__(?=\S)([\s\S]*?\S)__(?!_)/,

  // Italic/Em (*text* or _text_)
  // Phase 2: Removed negative lookahead (?!\*) to allow nesting like *italic **bold***
  // The strong pattern is checked first, so **text** won't be caught by this
  em: /^\*(?=\S)([\s\S]*?\S)\*|^_(?=\S)([\s\S]*?\S)_/,

  // CommonMark angle autolinks: <scheme:destination> and <name@example.com>
  angleUri: /^<([A-Za-z][A-Za-z\d+.-]{1,31}:[^<>\x00-\x20]*)>/,
  angleEmail: /^<([A-Za-z\d.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z\d](?:[A-Za-z\d-]{0,61}[A-Za-z\d])?(?:\.[A-Za-z\d](?:[A-Za-z\d-]{0,61}[A-Za-z\d])?)*)>/,

  // Line break (two spaces + newline)
  br: /^ {2,}\n(?!\s*$)/,

  // Plain text (everything else)
  // Phase 6: Keep negative lookahead for autolinks (necessary for correct parsing)
  text: /^[^*_`[<\n\\!~]+/,
  gfmText: /^(?:(?!https?:\/\/|ftp:\/\/|www\.)[^*_`[<\n\\!~])+/i,
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

type InlineResult = { token: InlineToken; raw: string }

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
  openingAngles: number[]
  closingAngles: number[]
  whitespaces: number[]
  doubleQuotes: number[]
  singleQuotes: number[]
  matchingParentheses: Map<number, number>
  parenthesisBalance: Int32Array
  destinations: Map<number, ParsedLinkDestination | null>
  asteriskRuns: DelimiterRun[]
  asteriskEmClosers: DelimiterRun[]
  asteriskStrongClosers: DelimiterRun[]
  underscoreRuns: DelimiterRun[]
  underscoreEmClosers: DelimiterRun[]
  underscoreStrongClosers: DelimiterRun[]
  tildeClosers: number[]
  backtickRuns: DelimiterRun[]
  backtickClosers: Map<number, DelimiterRun[]>
  htmlClosingAngles: number[]
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

    // Build text pattern that stops at custom trigger chars
    if (hasGeneralRules) {
      // General rules need single-char text matching to get a chance at every position
      this.textPattern = this.gfmSupport
        ? /^(?:(?!https?:\/\/|ftp:\/\/|www\.)[^*_`[<\n\\!~])/i
        : /^[^*_`[<\n\\!~]/
    } else if (triggerCharSet.size > 0) {
      // Add trigger chars to the exclusion set so text doesn't consume them
      const extra = [...triggerCharSet]
        .map((c) => `\\u${c.toString(16).padStart(4, '0')}`)
        .join('')
      const gfmPrefix = this.gfmSupport
        ? '(?:(?!https?:\\/\\/|ftp:\\/\\/|www\\.)'
        : '(?:'
      this.textPattern = new RegExp(
        `^${gfmPrefix}[^*_\`[<\\n\\\\!~${extra}])+`,
        this.gfmSupport ? 'i' : undefined
      )
    } else {
      this.textPattern = this.gfmSupport ? PATTERNS.gfmText : PATTERNS.text
    }
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
    tokenBudget?: TokenBudget
  ): InlineToken[] {
    if (depth >= HARD_MAX_INLINE_NESTING_DEPTH || workBudget.remaining < src.length) {
      if (src) consumeTokenBudget(tokenBudget)
      return src ? [{ type: 'text', raw: src, text: src }] : []
    }
    workBudget.remaining -= src.length

    const tokens: InlineToken[] = []
    const linkScan = this.createLinkScan(src)
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
        tokenBudget
      )

      if (token) {
        this.assertProgress('inline tokenizer', src, cursor, token.raw)
        consumeTokenBudget(tokenBudget)
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
          consumeTokenBudget(tokenBudget)
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

    return tokens
  }

  private appendFallbackText(
    tokens: InlineToken[],
    fallbackTextIndex: number,
    raw: string,
    tokenBudget?: TokenBudget
  ): number {
    const previous = tokens[fallbackTextIndex]
    if (fallbackTextIndex === tokens.length - 1 && previous?.type === 'text') {
      previous.raw += raw
      previous.text += raw
      return fallbackTextIndex
    }
    consumeTokenBudget(tokenBudget)
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
    previousChar: string,
    linkScan: LinkScan,
    depth: number,
    workBudget: InlineWorkBudget,
    tokenBudget?: TokenBudget
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

    if (char === 92) {
      result = tryBuiltin(INLINE_RULE_PRIORITIES['escape'], () => this.tokenizeEscape(src()))
    } else if (char === 96) {
      result = tryBuiltin(
        INLINE_RULE_PRIORITIES['code'],
        () => this.tokenizeCode(source, cursor, linkScan)
      )
    } else if (char === 42 || char === 95) {
      result = tryBuiltin(
        INLINE_RULE_PRIORITIES['strong'],
        () => this.tokenizeStrong(
          source, cursor, references, previousChar, linkScan, depth, workBudget, tokenBudget
        )
      )
      if (!result) {
        result = tryBuiltin(
          INLINE_RULE_PRIORITIES['em'],
          () => this.tokenizeEm(
            source, cursor, references, previousChar, linkScan, depth, workBudget, tokenBudget
          )
        )
      }
    } else if (char === 126 && this.gfmSupport) {
      result = tryBuiltin(
        INLINE_RULE_PRIORITIES['del'],
        () => this.tokenizeDel(
          source, cursor, references, linkScan, depth, workBudget, tokenBudget
        )
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
      this.gfmSupport
      && (char === 72 || char === 104 || char === 70 || char === 102 || char === 87 || char === 119)
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
      result = tryBuiltin(INLINE_RULE_PRIORITIES['text'], () => this.tokenizeText(src()))
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

  private createLinkScan(src: string): LinkScan {
    const closingBrackets: number[] = []
    const openingAngles: number[] = []
    const closingAngles: number[] = []
    const whitespaces: number[] = []
    const doubleQuotes: number[] = []
    const singleQuotes: number[] = []
    const matchingParentheses = new Map<number, number>()
    const parenthesisStack: number[] = []
    const asteriskRuns: DelimiterRun[] = []
    const asteriskEmClosers: DelimiterRun[] = []
    const asteriskStrongClosers: DelimiterRun[] = []
    const underscoreRuns: DelimiterRun[] = []
    const underscoreEmClosers: DelimiterRun[] = []
    const underscoreStrongClosers: DelimiterRun[] = []
    const tildeClosers: number[] = []
    const backtickRuns: DelimiterRun[] = []
    const backtickClosers = new Map<number, DelimiterRun[]>()
    const htmlClosingAngles: number[] = []
    const lineBreaks: number[] = []
    let lastNonWhitespace = -1
    let parenthesisBalance = new Int32Array(0)
    let trackDirectSyntax = false
    let escaped = false
    let indexedDelimiterUntil = 0
    const delimiterIndex = {
      asteriskRuns,
      asteriskEmClosers,
      asteriskStrongClosers,
      underscoreRuns,
      underscoreEmClosers,
      underscoreStrongClosers,
    }

    for (let index = 0; index < src.length; index++) {
      const char = src.charCodeAt(index)
      if (this.inlineOptions.breaks && !/\s/.test(src[index])) lastNonWhitespace = index
      if (this.inlineOptions.allowHtml) {
        if (char === 62) htmlClosingAngles.push(index)
        else if (char === 10) lineBreaks.push(index)
      }
      if (this.gfmSupport?.isTildeCloser(src, index)) {
        tildeClosers.push(index)
      }
      if (char === 96 && src.charCodeAt(index - 1) !== 96) {
        this.indexBacktickRun(src, index, backtickRuns, backtickClosers)
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
        if (char === 93) {
          closingBrackets.push(index)
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
        if ((char === 42 || char === 95) && index >= indexedDelimiterUntil) {
          indexedDelimiterUntil = this.indexDelimiterRun(src, index, char, delimiterIndex)
        }
      }
    }

    return {
      closingBrackets,
      openingAngles,
      closingAngles,
      whitespaces,
      doubleQuotes,
      singleQuotes,
      matchingParentheses,
      parenthesisBalance,
      destinations: new Map(),
      asteriskRuns,
      asteriskEmClosers,
      asteriskStrongClosers,
      underscoreRuns,
      underscoreEmClosers,
      underscoreStrongClosers,
      tildeClosers,
      backtickRuns,
      backtickClosers,
      htmlClosingAngles,
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

  private indexDelimiterRun(
    src: string,
    start: number,
    char: number,
    closers: Pick<
      LinkScan,
      | 'asteriskRuns'
      | 'asteriskEmClosers'
      | 'asteriskStrongClosers'
      | 'underscoreRuns'
      | 'underscoreEmClosers'
      | 'underscoreStrongClosers'
    >
  ): number {
    let end = start + 1
    while (src.charCodeAt(end) === char) end++
    const length = end - start
    const previousChar = start > 0 ? src[start - 1] : ' '
    const nextChar = src[end] ?? ''
    const run = { start, length }

    if (char === 42) closers.asteriskRuns.push(run)
    else closers.underscoreRuns.push(run)

    if (
      /\S/.test(previousChar)
      && (
        char !== 95
        || !InlineTokenizerBase.isUnicodeAlphanumeric(previousChar)
        || !InlineTokenizerBase.isUnicodeAlphanumeric(nextChar)
      )
    ) {
      if (char === 42) {
        if (length === 1 || length >= 3) closers.asteriskEmClosers.push(run)
        if (length >= 2) closers.asteriskStrongClosers.push(run)
      } else {
        if (length === 1 || length >= 3) closers.underscoreEmClosers.push(run)
        if (length >= 2) closers.underscoreStrongClosers.push(run)
      }
    }

    return end
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

  private findEnclosingDelimiterRun(
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
    return run && run.start < position && run.start + run.length > position
      ? run
      : null
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
    if (!closingRun) return null

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

  /**
   * Tokenize strong (bold)
   */
  private tokenizeStrong(
    source: string,
    cursor: number,
    references: ReadonlyMap<string, LinkReference>,
    previousChar: string,
    linkScan: LinkScan,
    depth: number,
    workBudget: InlineWorkBudget,
    tokenBudget?: TokenBudget
  ): { token: InlineToken; raw: string } | null {
    // Try ** or __ delimiters
    if (source.startsWith('**', cursor)) {
      const result = this.findClosingDelimiter(source, cursor, '*', 2, linkScan)
      if (result) {
        const { content, raw } = result
        const tokens = this.tokenizeInternal(
          content, references, depth + 1, workBudget, tokenBudget
        )
        return {
          token: {
            type: 'strong',
            raw,
            text: content,
            tokens,
          },
          raw,
        }
      }
    }

    if (source.startsWith('__', cursor)) {
      if (
        InlineTokenizerBase.isUnicodeAlphanumeric(previousChar)
        && InlineTokenizerBase.isUnicodeAlphanumeric(source[cursor + 2] ?? '')
      ) {
        return null
      }
      const result = this.findClosingDelimiter(source, cursor, '_', 2, linkScan)
      if (result) {
        const { content, raw } = result
        const tokens = this.tokenizeInternal(
          content, references, depth + 1, workBudget, tokenBudget
        )
        return {
          token: {
            type: 'strong',
            raw,
            text: content,
            tokens,
          },
          raw,
        }
      }
    }

    return null
  }

  /**
   * Tokenize emphasis (italic)
   */
  private tokenizeEm(
    source: string,
    cursor: number,
    references: ReadonlyMap<string, LinkReference>,
    previousChar: string,
    linkScan: LinkScan,
    depth: number,
    workBudget: InlineWorkBudget,
    tokenBudget?: TokenBudget
  ): { token: InlineToken; raw: string } | null {
    // Try * or _ delimiters (but not ** or __)
    if (source.startsWith('*', cursor) && !source.startsWith('**', cursor)) {
      const result = this.findClosingDelimiter(source, cursor, '*', 1, linkScan)
      if (result) {
        const { content, raw } = result
        const tokens = this.tokenizeInternal(
          content, references, depth + 1, workBudget, tokenBudget
        )
        return {
          token: {
            type: 'em',
            raw,
            text: content,
            tokens,
          },
          raw,
        }
      }
    }

    if (source.startsWith('_', cursor) && !source.startsWith('__', cursor)) {
      if (
        InlineTokenizerBase.isUnicodeAlphanumeric(previousChar)
        && InlineTokenizerBase.isUnicodeAlphanumeric(source[cursor + 1] ?? '')
      ) {
        return null
      }
      const result = this.findClosingDelimiter(source, cursor, '_', 1, linkScan)
      if (result) {
        const { content, raw } = result
        const tokens = this.tokenizeInternal(
          content, references, depth + 1, workBudget, tokenBudget
        )
        return {
          token: {
            type: 'em',
            raw,
            text: content,
            tokens,
          },
          raw,
        }
      }
    }

    return null
  }

  /**
   * Tokenize strikethrough (del)
   * Phase 4: GFM extension for ~~strikethrough~~
   */
  private tokenizeDel(
    source: string,
    cursor: number,
    references: ReadonlyMap<string, LinkReference>,
    linkScan: LinkScan,
    depth: number,
    workBudget: InlineWorkBudget,
    tokenBudget?: TokenBudget
  ): { token: InlineToken; raw: string } | null {
    const match = this.gfmSupport?.tokenizeDelete(
      source,
      cursor,
      linkScan.tildeClosers
    )
    if (!match) return null
    const { raw, text } = match

    // Recursively tokenize content
    const tokens = this.tokenizeInternal(
      text, references, depth + 1, workBudget, tokenBudget
    )

    return {
      token: {
        type: 'del',
        raw,
        text,
        tokens,
      },
      raw,
    }
  }

  /**
   * Find closing delimiter for emphasis/strong
   * using the one-pass delimiter index built for this inline source.
   */
  private findClosingDelimiter(
    source: string,
    cursor: number,
    delimiter: '*' | '_',
    delimiterLength: 1 | 2,
    linkScan: LinkScan
  ): { content: string; raw: string } | null {
    // Content must start with non-whitespace
    const contentStart = cursor + delimiterLength
    if (contentStart >= source.length || /^\s/.test(source[contentStart])) {
      return null
    }

    const allRuns = delimiter === '*' ? linkScan.asteriskRuns : linkScan.underscoreRuns
    const indexedClosers = delimiter === '*'
      ? delimiterLength === 1
        ? linkScan.asteriskEmClosers
        : linkScan.asteriskStrongClosers
      : delimiterLength === 1
        ? linkScan.underscoreEmClosers
        : linkScan.underscoreStrongClosers
    const enclosingRun = this.findEnclosingDelimiterRun(allRuns, contentStart)
    const suffixLength = enclosingRun
      ? enclosingRun.start + enclosingRun.length - contentStart
      : 0
    const suffixCanClose = delimiterLength === 1
      ? suffixLength === 1 || suffixLength >= 3
      : suffixLength >= 2
    const run = suffixCanClose
      ? { start: contentStart, length: suffixLength }
      : this.findDelimiterRun(indexedClosers, contentStart)
    if (!run) return null

    // Triple-or-longer runs are fully consumed. Extra delimiter characters
    // stay inside the recursively parsed content, preserving existing output.
    const contentEnd = run.length === delimiterLength
      ? run.start
      : run.start + run.length - delimiterLength
    const rawEnd = run.start + run.length
    return {
      content: source.slice(contentStart, contentEnd),
      raw: source.slice(cursor, rawEnd),
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

    const closingBracket = this.findPosition(
      linkScan.closingBrackets,
      openBracket + 1
    )
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
    if (!destination) return null

    const raw = src.slice(cursor, destination.end)
    const { href, title } = destination

    if (isImage) {
      return {
        token: {
          type: 'image',
          raw,
          href,
          title,
          text,
        },
        raw,
      }
    }

    // Recursively tokenize link text
    const tokens = this.tokenizeInternal(
      text, references, depth + 1, workBudget, tokenBudget
    )

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
    if (!text || text.length > 999 || text.includes('\n')) return null

    let end = closingBracket + 1
    let label = text
    if (src.charCodeAt(end) === 91) {
      const explicitClosingBracket = this.findPosition(
        linkScan.closingBrackets,
        end + 1
      )
      if (explicitClosingBracket === -1) return null

      const explicitLabel = src.slice(end + 1, explicitClosingBracket)
      if (explicitLabel.length > 999 || explicitLabel.includes('\n')) return null
      if (explicitLabel) label = explicitLabel
      end = explicitClosingBracket + 1
    }

    const reference = references.get(InlineTokenizerBase.normalizeReferenceLabel(label))
    if (!reference) return null

    const raw = src.slice(cursor, end)
    if (isImage) {
      return {
        token: { type: 'image', raw, text, href: reference.href, title: reference.title },
        raw,
      }
    }

    return {
      token: {
        type: 'link',
        raw,
        text,
        href: reference.href,
        title: reference.title,
        tokens: this.tokenizeInternal(
          text, references, depth + 1, workBudget, tokenBudget
        ),
      },
      raw,
    }
  }

  private parseLinkDestination(
    src: string,
    start: number,
    linkScan: LinkScan
  ): ParsedLinkDestination | null {
    let cursor = start
    let href = ''

    if (src.charCodeAt(cursor) === 60) {
      const hrefStart = cursor + 1
      const hrefEnd = this.findPosition(linkScan.closingAngles, hrefStart)
      if (hrefEnd === -1) return null

      const nestedOpening = this.findPosition(linkScan.openingAngles, hrefStart)
      if (nestedOpening !== -1 && nestedOpening < hrefEnd) return null

      const lineBreak = this.findPosition(linkScan.whitespaces, hrefStart)
      if (lineBreak !== -1 && lineBreak < hrefEnd) return null

      href = src.slice(hrefStart, hrefEnd)
      cursor = hrefEnd + 1
    } else {
      const outerOpening = start - 1
      const outerClosing = linkScan.matchingParentheses.get(outerOpening)
      const whitespace = this.findPosition(linkScan.whitespaces, start)

      if (
        outerClosing !== undefined
        && (whitespace === -1 || outerClosing < whitespace)
      ) {
        href = InlineTokenizerBase.unescapePunctuation(src.slice(start, outerClosing))
        return { end: outerClosing + 1, href }
      }

      if (whitespace === -1) return null
      const balance = (
        linkScan.parenthesisBalance[whitespace]
        - linkScan.parenthesisBalance[start]
      )
      if (balance !== 0) return null

      href = src.slice(start, whitespace)
      cursor = whitespace
    }

    href = InlineTokenizerBase.unescapePunctuation(href)
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

    const title = InlineTokenizerBase.unescapePunctuation(src.slice(titleStart, titleEnd))
    cursor = titleEnd + 1
    while (InlineTokenizerBase.isWhitespace(src.charCodeAt(cursor))) cursor++
    if (src.charCodeAt(cursor) !== 41) return null

    return { end: cursor + 1, href, title }
  }

  private static isWhitespace(char: number): boolean {
    return char === 32 || char === 9 || char === 10 || char === 13
  }

  private static isUnicodeAlphanumeric(char: string): boolean {
    return /[\p{L}\p{N}]/u.test(char)
  }

  private static unescapePunctuation(value: string): string {
    return value.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g, '$1')
  }

  private tokenizeHtml(
    source: string,
    cursor: number,
    linkScan: LinkScan
  ): { token: InlineToken; raw: string } | null {
    let end = -1

    if (source.startsWith('<!--', cursor)) {
      const closing = source.indexOf('-->', cursor + 4)
      end = closing === -1 ? source.length : closing + 3
    } else if (source.startsWith('<?', cursor)) {
      const closing = source.indexOf('?>', cursor + 2)
      end = closing === -1 ? source.length : closing + 2
    } else if (source.startsWith('<![CDATA[', cursor)) {
      const closing = source.indexOf(']]>', cursor + 9)
      end = closing === -1 ? source.length : closing + 3
    } else {
      const declaration = source.charCodeAt(cursor + 1) === 33
        && source.charCodeAt(cursor + 2) >= 65
        && source.charCodeAt(cursor + 2) <= 90
      const tagName = source.charCodeAt(cursor + 1) === 47
        ? source.charCodeAt(cursor + 2)
        : source.charCodeAt(cursor + 1)
      const tag = (tagName >= 65 && tagName <= 90) || (tagName >= 97 && tagName <= 122)
      if (!declaration && !tag) return null

      const closing = this.findPosition(linkScan.htmlClosingAngles, cursor + 2)
      if (closing === -1) return null
      const lineBreak = this.findPosition(linkScan.lineBreaks, cursor + 2)
      if (lineBreak !== -1 && lineBreak < closing) return null
      end = closing + 1
    }

    const raw = source.slice(cursor, end)
    return { token: { type: 'html', raw, text: raw }, raw }
  }

  static normalizeReferenceLabel(label: string): string {
    return label.trim().replace(/\s+/g, ' ').toLowerCase()
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
    const text = raw

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
