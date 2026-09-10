/** Shared setup for the highlighting and presentation plugins. */
import type { CodeToken, CodeBlockContext, DocumentContext } from '../core/types.js'
import type { HighlightGrammar, HighlightOptions, HighlightErrorContext } from './highlight.js'
import { createCodeBlockContext, getCodeBlockMetadata } from '../core/code-block.js'
import { escape } from '../utils/escape.js'

export function createHighlightRenderer<
  TGrammar extends HighlightGrammar,
  TToken,
  TTheme = unknown,
>(options: HighlightOptions<TGrammar, TToken, TTheme>, fallback = renderPlainCode, collectMetadata = true): {
  code(token: CodeToken, suppliedContext?: CodeBlockContext, document?: DocumentContext): string
  styles: string
} {
  const {
    grammars,
    tokenize: tokenizeFn,
    renderToHTML: renderFn,
    getThemeStylesheet: getStylesheetFn,
    validateThemeContrast: validateContrastFn,
    theme,
    styleMode,
    lineNumbers = false,
    wrapLines,
    startLine, hooks, renderOptions, highlightRanges,
    classPrefix = 'neo-hl',
    diffHighlight,
    maxInputLength,
    maxMatchCount,
    maxTokenCount,
    maxTokenDepth,
    maxRenderedLength,
    maxLines,
    errorPolicy = 'throw',
    onError,
    injectStyles = true,
  } = options

  if (wrapLines !== undefined && typeof wrapLines !== 'boolean' && wrapLines !== 'source') throw new TypeError('wrapLines must be a boolean or "source"')
  if (startLine !== undefined && (!Number.isSafeInteger(startLine) || startLine < 1)) {
    throw new RangeError('startLine must be a positive safe integer')
  }
  if (renderOptions !== undefined && typeof renderOptions !== 'function') throw new TypeError('renderOptions must be a function')
  if (errorPolicy !== 'throw' && errorPolicy !== 'plain') {
    throw new TypeError('errorPolicy must be "throw" or "plain"')
  }
  // Reject configuration mistakes before per-block recovery can hide them.
  const limits = { maxInputLength, maxMatchCount, maxTokenCount, maxTokenDepth, maxRenderedLength, maxLines }
  for (const [name, value] of Object.entries(limits)) {
    if (value !== undefined && value !== Infinity && (!Number.isInteger(value) || value < 0)) {
      throw new RangeError(`${name} must be a non-negative integer or Infinity`)
    }
  }
  if (styleMode !== undefined && styleMode !== 'inline' && styleMode !== 'class') {
    throw new TypeError('styleMode must be "inline" or "class"')
  }
  if (!/^-?[_a-zA-Z]+[_a-zA-Z\d-]*$/.test(classPrefix)) {
    throw new TypeError('classPrefix must be a safe CSS identifier')
  }

  const tokenizeOptions = { maxInputLength, maxMatchCount, maxTokenCount, maxTokenDepth }

  // Build grammar registry: name/alias → Grammar
  const registry = new Map<string, TGrammar>()
  for (const grammar of grammars) {
    registry.set(grammar.name.trim().toLowerCase(), grammar)
    if (grammar.aliases) {
      for (const alias of grammar.aliases) {
        registry.set(alias.trim().toLowerCase(), grammar)
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

  // Pre-generate the theme stylesheet (CSS for token color classes)
  let stylesheet = injectStyles && getStylesheetFn && theme ? getStylesheetFn(theme, classPrefix) : undefined
  const themeCSS = stylesheet !== undefined ? `<style>${stylesheet}</style>` : ''

  return { styles: themeCSS, code: (token, suppliedContext, document) => {
      const context = suppliedContext ?? createCodeBlockContext(token)
      const language = context.language
      const grammar = language ? registry.get(language) : undefined
      if (document && collectMetadata) {
        for (const diagnostic of getCodeBlockMetadata(context).diagnostics) {
          document.reportDiagnostic({ source: 'code-metadata', code: diagnostic.code, severity: 'warning',
            message: diagnostic.message, metaRange: { start: diagnostic.start, end: diagnostic.end } })
        }
      }

      // No grammar match — fallback to default rendering (plain <code>)
      if (!grammar) {
        if (language) document?.reportDiagnostic({ source: 'highlight', code: 'unknown-language', severity: 'warning',
          message: `No grammar found for language "${language}". Code block rendered as plain text.` })
        // Dev-mode: warn about unknown language strings (catch typos)
        if (token.lang && typeof process !== 'undefined' && process.env?.['NODE_ENV'] !== 'production') {
          console.warn(`neo.highlight: no grammar found for language "${token.lang}". Code block rendered as plain text.`)
        }

        return fallback(token, context)
      }

      // Parse highlight lines from meta
      const metadata = getCodeBlockMetadata(context)
      const highlightLines = metadata.highlightLines.length ? [...metadata.highlightLines] : undefined

      // Tokenize and render with neo.highlight
      let stage: HighlightErrorContext['stage'] = 'configure'
      let html: string
      try {
        const selected = renderOptions?.(Object.freeze({ ...context, metadata, grammar, resolvedLanguage: grammar.name.trim().toLowerCase() }))
        if (selected !== undefined && (!selected || typeof selected !== 'object' || 'then' in selected)) {
          throw new TypeError('renderOptions must return synchronous options or undefined')
        }
        const lineLayout = selected?.wrapLines ?? wrapLines
        stage = 'tokenize'
        const tokens = tokenizeFn(token.text, grammar, tokenizeOptions)
        stage = 'render'
        html = renderFn(tokens, {
          theme,
          styleMode,
          language,
          lineNumbers: selected?.lineNumbers ?? lineNumbers,
          ...(lineLayout === undefined ? {} : { wrapLines: lineLayout }),
          startLine: selected?.startLine ?? startLine,
          hooks: selected?.hooks ?? hooks,
          highlightLines: selected?.highlightLines ?? highlightLines,
          highlightRanges: selected?.highlightRanges ?? highlightRanges,
          diffHighlight: selected?.diffHighlight ?? (typeof diffHighlight === 'function' ? diffHighlight(token) : diffHighlight),
          classPrefix,
          maxTokenCount,
          maxTokenDepth,
          maxRenderedLength,
          maxLines,
        }) + '\n'
      } catch (error) {
        onError?.(error, { stage, code: token.text, language, meta: token.meta })
        if (errorPolicy === 'throw') throw error
        document?.reportDiagnostic({ source: 'highlight', code: 'highlight-failed', severity: 'warning', field: stage,
          message: error instanceof Error ? error.message : 'Syntax highlighting failed. Code block rendered as plain text.' })
        return fallback(token, context)
      }
      // Collection failures must not be swallowed by syntax recovery.
      if (document && theme) {
        if (getStylesheetFn) {
          stylesheet ??= getStylesheetFn(theme, classPrefix)
          document.addStylesheet({ id: `neo.highlight:${classPrefix}`, css: stylesheet })
        } else if (styleMode === 'class') {
          document.reportDiagnostic({ source: 'highlight', code: 'stylesheet-unavailable', severity: 'warning',
            message: 'Class output needs a theme stylesheet. Supply getThemeStylesheet to include it in the document result.' })
        }
      }
      return html
    },
  }
}

function renderPlainCode(token: CodeToken, _context?: CodeBlockContext): string {
  const language = token.lang?.trim().toLowerCase()
  const langClass = language ? ` class="language-${escape(language)}"` : ''
  return `<pre><code${langClass}>${escape(token.text)}</code></pre>\n`
}
