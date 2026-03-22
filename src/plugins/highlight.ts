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

import type { MarkdownPlugin, CodeToken } from '../core/types.js'
import { escape } from '../utils/escape.js'

/**
 * Grammar interface (matches @lpm.dev/neo.highlight Grammar)
 */
interface Grammar {
  name: string
  aliases?: string[]
  tokens: Record<string, unknown>
}

/**
 * Theme type — pass-through to @lpm.dev/neo.highlight, accepts any theme object or name
 */
type Theme = unknown

/**
 * Highlight plugin options
 *
 * Pass `tokenize` and `renderToHTML` from @lpm.dev/neo.highlight directly.
 * Method syntax is used for the function signatures to enable bivariant
 * type checking — this allows neo.highlight's specific types to be passed
 * without explicit casts.
 */
export interface HighlightOptions {
  /** Grammars to register for language detection */
  grammars: Grammar[]
  /** Tokenize function from @lpm.dev/neo.highlight */
  tokenize(code: string, grammar: Grammar): unknown[]
  /** Render function from @lpm.dev/neo.highlight */
  renderToHTML(tokens: unknown[], options?: Record<string, unknown>): string
  /** getThemeStylesheet function from @lpm.dev/neo.highlight (generates CSS for token colors) */
  getThemeStylesheet?(theme: Theme, classPrefix?: string): string
  /** validateThemeContrast function from @lpm.dev/neo.highlight (WCAG AA validation) */
  validateThemeContrast?(theme: Theme): { passed: boolean; results: Array<{ token: string; color: string; ratio: number; pass: boolean }> }
  /** Theme for syntax coloring (pass a theme object or name from @lpm.dev/neo.highlight) */
  theme?: Theme
  /** Show line numbers (default: false) */
  lineNumbers?: boolean
  /** CSS class prefix (default: "neo-hl") */
  classPrefix?: string
}

/**
 * Parse highlight line ranges from meta string
 *
 * Supports formats: {1,3-5}, {1}, {1,2,3}
 *
 * @param meta - Code block meta string
 * @returns Array of 1-indexed line numbers to highlight, or undefined
 */
export function parseHighlightLines(meta?: string): number[] | undefined {
  if (!meta) return undefined

  const match = /\{([\d,\s-]+)\}/.exec(meta)
  if (!match) return undefined

  const lines: number[] = []
  const parts = match[1].split(',')

  for (const part of parts) {
    const trimmed = part.trim()
    const rangeMatch = /^(\d+)-(\d+)$/.exec(trimmed)

    if (rangeMatch) {
      const start = parseInt(rangeMatch[1], 10)
      const end = parseInt(rangeMatch[2], 10)
      for (let i = start; i <= end; i++) {
        lines.push(i)
      }
    } else {
      const num = parseInt(trimmed, 10)
      if (!isNaN(num)) {
        lines.push(num)
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
export function highlightPlugin(options: HighlightOptions): MarkdownPlugin {
  const {
    grammars,
    tokenize: tokenizeFn,
    renderToHTML: renderFn,
    getThemeStylesheet: getStylesheetFn,
    validateThemeContrast: validateContrastFn,
    theme,
    lineNumbers = false,
    classPrefix = 'neo-hl',
  } = options

  // Build grammar registry: name/alias → Grammar
  const registry = new Map<string, Grammar>()
  for (const grammar of grammars) {
    registry.set(grammar.name, grammar)
    if (grammar.aliases) {
      for (const alias of grammar.aliases) {
        registry.set(alias, grammar)
      }
    }
  }

  // Dev-mode: validate theme contrast (WCAG AA)
  if (validateContrastFn && theme && typeof process !== 'undefined' && process.env?.['NODE_ENV'] !== 'production') {
    const report = validateContrastFn(theme)
    if (!report.passed) {
      for (const result of report.results) {
        if (!result.pass) {
          console.warn(
            `neo.highlight: theme "${(theme as { name?: string }).name ?? 'unknown'}" ${result.token} color ${result.color} ` +
            `has contrast ratio ${result.ratio}:1 against background (needs 4.5:1 for WCAG AA)`
          )
        }
      }
    }
  }

  // Track unknown languages for dev warnings
  const warnedLanguages = new Set<string>()

  // Pre-generate the theme stylesheet (CSS for token color classes)
  const themeCSS = getStylesheetFn && theme
    ? `<style>${getStylesheetFn(theme, classPrefix)}</style>`
    : ''

  return (builder) => {
    // Inject theme CSS into the output once (at the beginning)
    if (themeCSS) {
      let injected = false
      builder.addHtmlTransform((html) => {
        if (injected) return html
        injected = true
        return themeCSS + html
      })
    }

    builder.setRenderer('code', (token: CodeToken) => {
      const grammar = token.lang ? registry.get(token.lang) : undefined

      // No grammar match — fallback to default rendering (plain <code>)
      if (!grammar) {
        // Dev-mode: warn about unknown language strings (catch typos)
        if (token.lang && typeof process !== 'undefined' && process.env?.['NODE_ENV'] !== 'production') {
          if (!warnedLanguages.has(token.lang)) {
            warnedLanguages.add(token.lang)
            console.warn(`neo.highlight: no grammar found for language "${token.lang}". Code block rendered as plain text.`)
          }
        }

        const code = escape(token.text)
        const langClass = token.lang ? ` class="language-${escape(token.lang)}"` : ''
        return `<pre><code${langClass}>${code}</code></pre>\n`
      }

      // Parse highlight lines from meta
      const highlightLines = parseHighlightLines(token.meta)

      // Tokenize and render with neo.highlight
      const tokens = tokenizeFn(token.text, grammar)
      return renderFn(tokens, {
        theme,
        language: token.lang,
        lineNumbers,
        highlightLines,
        classPrefix,
      }) + '\n'
    })
  }
}
