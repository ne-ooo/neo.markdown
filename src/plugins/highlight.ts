/**
 * Syntax highlighting plugin for neo.markdown
 *
 * Wires @lpm.dev/neo.highlight into code block rendering.
 * Pass `tokenize` and `renderToHTML` from neo.highlight directly for synchronous operation.
 *
 * @example
 * ```typescript
 * import { highlightPlugin } from '@lpm.dev/neo.markdown/plugins/highlight'
 * import { tokenize, renderToHTML } from '@lpm.dev/neo.highlight'
 * import { javascript, typescript } from '@lpm.dev/neo.highlight/grammars'
 * import { githubDark } from '@lpm.dev/neo.highlight/themes/github-dark'
 *
 * const html = parse(markdown, {
 *   plugins: [
 *     highlightPlugin({
 *       grammars: [javascript, typescript],
 *       theme: githubDark,
 *       tokenize,
 *       renderToHTML,
 *     })
 *   ]
 * })
 * ```
 */

import type { MarkdownPlugin, CodeToken, CodeBlockContext, CodeBlockMetadata } from '../core/types.js'
import { createHighlightRenderer } from './highlight-renderer.js'

/**
 * Grammar interface (matches @lpm.dev/neo.highlight Grammar)
 */
export interface HighlightGrammar {
  name: string
  aliases?: string[]
  tokens: Record<string, unknown>
}

/**
 * Resource limits passed to the tokenizer.
 */
export type HighlightTokenizeOptions = {
  maxInputLength?: number
  maxMatchCount?: number
  maxTokenCount?: number
  maxTokenDepth?: number
}

export type HighlightDiff = {
  added?: number[]
  removed?: number[]
  modified?: number[]
}

/** Half-open UTF-16 offsets in the code passed to the syntax renderer. */
export type HighlightRange = { readonly start: number; readonly end: number }

/** Structural equivalents of neo.highlight hooks, with no runtime dependency. */
export type HighlightRenderAttributes = {
  class?: string | readonly string[]
  attributes?: Readonly<Record<string, string | number | boolean | undefined>>
}
export type HighlightRenderContext = {
  readonly source: string
  readonly language: string | undefined
  readonly classPrefix: string
  readonly styleMode: 'inline' | 'class'
}
export type HighlightTokenRenderContext = HighlightRenderContext & {
  readonly type: string; readonly aliases: readonly string[]; readonly depth: number
  readonly start: number; readonly end: number
}
export type HighlightLineRenderContext = HighlightRenderContext & {
  readonly line: number; readonly displayLine: number; readonly start: number; readonly end: number
  readonly highlighted: boolean; readonly added: boolean; readonly removed: boolean; readonly modified: boolean
}
export type HighlightRenderHooks = {
  token?: (context: HighlightTokenRenderContext) => HighlightRenderAttributes | void
  line?: (context: HighlightLineRenderContext) => HighlightRenderAttributes | void
  code?: (context: HighlightRenderContext) => HighlightRenderAttributes | void
  pre?: (context: HighlightRenderContext) => HighlightRenderAttributes | void
}

export type HighlightCodeBlockContext<TGrammar extends HighlightGrammar = HighlightGrammar> = CodeBlockContext & {
  readonly metadata: CodeBlockMetadata
  readonly grammar: TGrammar
  /** Canonical name of the selected grammar. The output language keeps the normalized input spelling. */
  readonly resolvedLanguage: string
}

/** Renderer options shared with neo.highlight, without a runtime dependency. */
export type HighlightRenderOptions<TTheme = unknown> = {
  theme?: TTheme
  styleMode?: 'inline' | 'class'
  language?: string
  lineNumbers?: boolean
  /** Per-line spans; "source" retains line endings as text. */
  wrapLines?: boolean | 'source'
  startLine?: number
  hooks?: HighlightRenderHooks
  highlightLines?: number[]
  highlightRanges?: readonly HighlightRange[]
  diffHighlight?: HighlightDiff
  classPrefix?: string
  maxTokenCount?: number
  maxTokenDepth?: number
  maxRenderedLength?: number
  maxLines?: number
}

export type HighlightErrorContext = {
  /** Stage that failed. */
  stage: 'configure' | 'tokenize' | 'render'
  /** Source and metadata from the Markdown code token. */
  code: string
  language: string | undefined
  meta: string | undefined
}

/**
 * Highlight plugin options
 *
 * Pass `tokenize` and `renderToHTML` from @lpm.dev/neo.highlight directly.
 * Grammar, token, and theme types are inferred from the supplied functions.
 */
export interface HighlightOptions<
  TGrammar extends HighlightGrammar = HighlightGrammar,
  TToken = unknown,
  TTheme = unknown,
> extends HighlightTokenizeOptions {
  /** Grammars to register for language detection */
  grammars: readonly TGrammar[]
  /** Tokenize function from @lpm.dev/neo.highlight */
  tokenize: (code: string, grammar: TGrammar, options?: HighlightTokenizeOptions) => TToken[]
  /** Render function from @lpm.dev/neo.highlight */
  renderToHTML: (tokens: TToken[], options: HighlightRenderOptions<TTheme>) => string
  /** getThemeStylesheet function from @lpm.dev/neo.highlight (generates CSS for token colors) */
  getThemeStylesheet?: (theme: TTheme, classPrefix?: string) => string
  /** validateThemeContrast function from @lpm.dev/neo.highlight (WCAG AA validation) */
  validateThemeContrast?: (theme: TTheme) => { passed: boolean; results: Array<{ token: string; color: string; ratio: number; pass: boolean }> }
  /** Theme for syntax coloring (pass a theme object or name from @lpm.dev/neo.highlight) */
  theme?: TTheme
  /** Inline styles (default), or classes with a separately supplied theme stylesheet. */
  styleMode?: 'inline' | 'class'
  /** Show line numbers (default: false) */
  lineNumbers?: boolean
  /** Per-line spans; "source" retains line endings as text. */
  wrapLines?: boolean | 'source'
  /** First displayed line number (default: 1). Line selections remain source-relative. */
  startLine?: number
  /** Decorators for highlighted tokens, lines, and wrappers. */
  hooks?: HighlightRenderHooks
  /** Select rendering options per matched block. Resource limits remain fixed by plugin configuration. */
  renderOptions?: (context: HighlightCodeBlockContext<TGrammar>) => HighlightBlockRenderOptions<TTheme> | void
  /** CSS class prefix (default: "neo-hl") */
  classPrefix?: string
  /** Selected source ranges, counted in UTF-16 code units. */
  highlightRanges?: readonly HighlightRange[]
  /** Diff lines for every block, or a function that selects them per block. */
  diffHighlight?: HighlightDiff | ((token: Readonly<CodeToken>) => HighlightDiff | undefined)
  /** Maximum generated HTML length per highlighted block. */
  maxRenderedLength?: number
  /** Maximum source lines per highlighted block. */
  maxLines?: number
  /** On highlighting failure: throw (default), or render escaped source. */
  errorPolicy?: 'throw' | 'plain'
  /** Receives highlighting failures before the selected error policy applies. */
  onError?: (error: unknown, context: HighlightErrorContext) => void
  /** Include theme CSS in each document (default: true when a stylesheet function is supplied). */
  injectStyles?: boolean
}

/** Per-block visual options cannot replace resource limits or the output language. */
export type HighlightBlockRenderOptions<TTheme = unknown> = Pick<HighlightRenderOptions<TTheme>,
  'lineNumbers' | 'wrapLines' | 'startLine' | 'highlightLines' | 'highlightRanges' | 'diffHighlight' | 'hooks'>

/** Hard limit for expanded highlight metadata. */
export const MAX_HIGHLIGHT_LINES = 10_000

/**
 * Parse highlight line ranges from meta string
 *
 * Supports formats: {1,3-5}, {1}, {1,2,3}
 *
 * @param meta - Code block meta string
 * @param maxLines - Highest line number to return (hard-capped at 10,000)
 * @returns Array of 1-indexed line numbers to highlight, or undefined
 */
export function parseHighlightLines(
  meta?: string,
  maxLines: number = MAX_HIGHLIGHT_LINES
): number[] | undefined {
  if (!meta) return undefined

  const boundedMax = Number.isSafeInteger(maxLines) && maxLines > 0
    ? Math.min(maxLines, MAX_HIGHLIGHT_LINES)
    : 0
  if (boundedMax === 0) return undefined

  const match = /\{([\d,\s-]+)\}/.exec(meta)
  if (!match) return undefined

  const lines: number[] = []
  const seen = new Set<number>()
  const parts = match[1].split(',')

  const addLine = (line: number): void => {
    if (line <= boundedMax && !seen.has(line) && lines.length < boundedMax) {
      seen.add(line)
      lines.push(line)
    }
  }

  for (const part of parts) {
    const trimmed = part.trim()
    const rangeMatch = /^(\d+)-(\d+)$/.exec(trimmed)

    if (rangeMatch) {
      const start = Number(rangeMatch[1])
      const end = Number(rangeMatch[2])
      if (
        !Number.isSafeInteger(start)
        || !Number.isSafeInteger(end)
        || start < 1
        || end < start
        || start > boundedMax
      ) {
        continue
      }
      const boundedEnd = Math.min(end, boundedMax)
      for (let i = start; i <= boundedEnd; i++) {
        addLine(i)
      }
    } else {
      const num = Number(trimmed)
      if (Number.isSafeInteger(num) && num >= 1) {
        addLine(num)
      }
    }
  }

  return lines.length > 0 ? lines : undefined
}

/**
 * Create the highlight plugin
 *
 * @param options - Highlight options (grammars, tokenize, renderToHTML, theme, lineNumbers)
 * @returns Markdown plugin
 */
export function highlightPlugin<
  TGrammar extends HighlightGrammar,
  TToken,
  TTheme = unknown,
>(options: HighlightOptions<TGrammar, TToken, TTheme>): MarkdownPlugin {
  const { code, styles } = createHighlightRenderer(options)
  return builder => {
    if (styles) builder.addHtmlTransform(html => builder.document ? html : styles + html)
    builder.setRenderer('code', (token, context) => code(token, context, builder.document))
  }
}
