import type { CodeBlockContext, CodeToken, MarkdownPlugin } from '../core/types.js'
import { createCodeBlockContext, getCodeBlockMetadata, parseCodeMetadata } from '../core/code-block.js'
import { escape } from '../utils/escape.js'
import { createHighlightRenderer } from './highlight-renderer.js'
import { parseCodeWordRanges, renderCodeWordRanges } from './code-word-ranges.js'
import type {
  HighlightGrammar, HighlightOptions, HighlightDiff, HighlightRenderAttributes,
  HighlightLineRenderContext, HighlightRenderHooks, HighlightRange,
} from './highlight.js'

export interface CodePresentationDiagnostic {
  readonly field: string
  readonly message: string
}

export interface CodePresentationOptions<
  TGrammar extends HighlightGrammar = HighlightGrammar, TToken = unknown, TTheme = unknown,
> {
  /** Optional syntax highlighting. This plugin installs its own code renderer. */
  highlight?: HighlightOptions<TGrammar, TToken, TTheme>
  /** Presentation class prefix, independent of the syntax theme (default: neo-code). */
  classPrefix?: string
  lineNumbers?: boolean
  startLine?: number
  /** Inject presentation CSS once per document (default: true). */
  injectStyles?: boolean
  /** Limits include original source, rendered lines, and the complete figure. */
  maxInputLength?: number
  maxLines?: number
  maxRenderedLength?: number
  /** Invalid metadata uses defaults and reports diagnostics without changing source. */
  onDiagnostic?: (diagnostics: readonly CodePresentationDiagnostic[], context: CodeBlockContext) => void
}

interface Presentation {
  source: string
  lines: string[]
  caption?: string
  filename?: string
  label: string
  lineNumbers: boolean
  startLine: number
  focus: Set<number>
  highlights: Set<number>
  wordRanges: readonly HighlightRange[]
  hasWordMetadata: boolean
  added: Set<number>
  removed: Set<number>
  modified: Set<number>
  diagnostics: CodePresentationDiagnostic[]
}

function prefixOf(value = 'neo-code'): string {
  if (!/^-?[_a-zA-Z]+[_a-zA-Z\d-]*$/.test(value)) throw new TypeError('classPrefix must be a safe CSS identifier')
  return value
}

function limitOf(value: number | undefined, fallback: number, name: string): number {
  const limit = value ?? fallback
  if (limit !== Infinity && (!Number.isSafeInteger(limit) || limit < 0)) throw new RangeError(`${name} must be a non-negative safe integer or Infinity`)
  return limit
}

function checkSize(value: number, limit: number, name: string): void {
  if (value > limit) throw new RangeError(`Code presentation exceeds ${name} ${limit}`)
}

function readPresentation(context: CodeBlockContext, lineNumbers: boolean, startLine: number): Presentation {
  const metadata = getCodeBlockMetadata(context)
  const attrs = metadata.attributes
  const lines = context.source.split(/\r\n|\r|\n/)
  const diagnostics: CodePresentationDiagnostic[] = metadata.diagnostics.map(d => ({ field: 'metadata', message: d.message }))
  const invalid = (field: string): void => { diagnostics.push({ field, message: `Invalid ${field} metadata. The default applies` }) }
  const text = (key: string): string | undefined => {
    const value = attrs[key]
    if (value === true) invalid(key)
    return typeof value === 'string' && value.length > 0 ? value : undefined
  }
  const flag = (key: string, fallback: boolean): boolean => {
    const value = attrs[key]
    if (value === undefined) return fallback
    if (value === true || value === 'true') return true
    if (value === 'false') return false
    invalid(key)
    return fallback
  }
  const range = (key: string): Set<number> => {
    const value = attrs[key]
    if (value === undefined) return new Set()
    if (typeof value !== 'string' || !/^\s*\d+(?:\s*-\s*\d+)?(?:\s*,\s*\d+(?:\s*-\s*\d+)?)*\s*$/.test(value)) {
      invalid(key)
      return new Set()
    }
    const parsed = parseCodeMetadata(`{${value}}`, context.lineCount)
    if (parsed.diagnostics.length) { invalid(key); return new Set() }
    return new Set(parsed.highlightLines)
  }
  const caption = text('caption') ?? text('title')
  const filename = text('filename')
  if (attrs['start'] !== undefined) {
    const value = attrs['start']
    const parsed = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN
    if (Number.isSafeInteger(parsed) && parsed > 0 && Number.isSafeInteger(parsed + lines.length - 1)) startLine = parsed
    else invalid('start')
  }
  const state: Presentation = {
    source: context.source, lines, caption, filename,
    label: [caption, filename].filter(Boolean).join(' — ') || 'Code example',
    lineNumbers: flag('lines', lineNumbers), startLine,
    focus: range('focus'), highlights: new Set(metadata.highlightLines), wordRanges: [], hasWordMetadata: attrs['mark'] !== undefined,
    added: range('added'), removed: range('removed'), modified: range('modified'), diagnostics,
  }
  // Diff prefixes are an explicit authoring convention, independent of language syntax.
  if (flag('diff', false)) {
    state.lines = lines.map((line, index) => {
      if (line.startsWith('+ ')) { state.added.add(index + 1); return line.slice(2) }
      if (line.startsWith('- ')) { state.removed.add(index + 1); return line.slice(2) }
      return line.startsWith('  ') ? line.slice(2) : line
    })
    // Keep original line terminators, including the final terminator.
    let index = 0
    state.source = context.source.replace(/[^\r\n]+|\r\n|\r|\n/g, part => {
      if (/^[\r\n]/.test(part)) { index++; return part }
      return state.lines[index] ?? ''
    })
  }
  const words = parseCodeWordRanges(state.source, attrs['mark'])
  state.wordRanges = words.ranges
  if (words.error) diagnostics.push({ field: 'mark', message: words.error })
  return state
}

function combine(base: HighlightRenderAttributes, extra: HighlightRenderAttributes | void): HighlightRenderAttributes {
  if (extra === undefined) return base
  if (!extra || typeof extra !== 'object' || Array.isArray(extra) || 'then' in extra) throw new TypeError('A render hook must return attributes or undefined')
  const classes = (value: HighlightRenderAttributes['class']): readonly string[] => {
    if (value === undefined) return []
    if (typeof value === 'string') return value.split(/\s+/).filter(Boolean)
    if (!Array.isArray(value)) throw new TypeError('Hook classes must be a string or an array')
    return value
  }
  if (extra.attributes !== undefined && (!extra.attributes || typeof extra.attributes !== 'object' || Array.isArray(extra.attributes))) {
    throw new TypeError('Hook attributes must be an object')
  }
  for (const key of Object.keys(base.attributes ?? {})) {
    if (extra.attributes?.[key] !== undefined && extra.attributes[key] !== base.attributes?.[key]) {
      throw new TypeError(`Hook attribute conflicts with presentation attribute: ${key}`)
    }
  }
  return { class: [...classes(base.class), ...classes(extra.class)], attributes: { ...extra.attributes, ...base.attributes } }
}

function lineAttributes(state: Presentation, prefix: string, line: number, displayLine: number, diff: string | undefined): HighlightRenderAttributes {
  return {
    class: [ `${prefix}-line`, ...(state.highlights.has(line) ? [`${prefix}-highlighted`] : []), ...(state.focus.size ? [state.focus.has(line) ? `${prefix}-focused` : `${prefix}-dimmed`] : []) ],
    attributes: {
      'data-code-line': line, 'data-code-diff': diff,
      'data-copy-code-exclude': diff === 'removed' ? 'true' : undefined,
      ...(diff ? { role: 'group', 'aria-label': `${diff[0].toUpperCase()}${diff.slice(1)} line ${displayLine}` } : {}),
    },
  }
}

function mergeDiff(state: Presentation, extra?: HighlightDiff): HighlightDiff {
  const removed = new Set([...state.removed, ...(extra?.removed ?? [])])
  const added = new Set([...state.added, ...(extra?.added ?? [])].filter(line => !removed.has(line)))
  const modified = new Set([...state.modified, ...(extra?.modified ?? [])].filter(line => !removed.has(line) && !added.has(line)))
  return { added: [...added], removed: [...removed], modified: [...modified] }
}

/** Return presentation CSS for an external stylesheet or a style element. */
export function getCodePresentationStyles(options: Pick<CodePresentationOptions, 'classPrefix'> = {}): string {
  const p = prefixOf(options.classPrefix)
  return `.${p}{margin:1em 0;border:1px solid currentColor;border-radius:.5em;overflow:hidden}
.${p}-caption{display:flex;flex-wrap:wrap;gap:.5em;padding:.6em 1em;border-bottom:1px solid currentColor;font:inherit}
.${p}-title,.${p}-filename{overflow-wrap:anywhere}
.${p}-filename{font-family:monospace}
.${p}-source{margin:0;padding:1em;overflow:auto;tab-size:4}
.${p}-source>code{display:block;width:max-content;min-width:100%}
.${p}-source:focus-visible{outline:2px solid currentColor;outline-offset:-3px}
.${p}-line{display:block;min-height:1em}
.${p}-number,.${p}-gutter{display:inline-block;min-width:3ch;margin-right:1em;text-align:right;user-select:none}
.${p}-gutter{width:1.5em;min-width:0;margin-right:0;text-align:center}
.${p}-has-diff .${p}-line:not([data-code-diff])::before{content:"";display:inline-block;width:1.5em}
.${p}-highlighted{background:var(--${p}-highlight-bg,rgba(127,127,127,.15))}
.${p}-word-highlight{background:var(--${p}-word-highlight-bg,rgba(127,127,127,.25));border-radius:2px}
.${p}-dimmed{opacity:.65}
.${p}:hover .${p}-dimmed,.${p}:focus-within .${p}-dimmed{opacity:1}
.${p}-line[data-code-diff="added"]{background:var(--${p}-added-bg,rgba(46,160,67,.15))}
.${p}-line[data-code-diff="removed"]{background:var(--${p}-removed-bg,rgba(248,81,73,.15))}
.${p}-line[data-code-diff="modified"]{background:var(--${p}-modified-bg,rgba(210,153,34,.15))}
.${p}-legend{display:block;padding:.4em 1em;font-size:.85em}
@media(prefers-contrast:more){.${p}-dimmed{opacity:1}}`
}

/** Render reusable code figures with optional syntax highlighting. */
export function codePresentationPlugin<
  TGrammar extends HighlightGrammar = HighlightGrammar, TToken = unknown, TTheme = unknown,
>(options: CodePresentationOptions<TGrammar, TToken, TTheme> = {}): MarkdownPlugin {
  const prefix = prefixOf(options.classPrefix)
  let presentationStyles: string | undefined
  const maxInputLength = limitOf(options.maxInputLength, 250_000, 'maxInputLength')
  const maxLines = limitOf(options.maxLines, 10_000, 'maxLines')
  const maxRenderedLength = limitOf(options.maxRenderedLength, 10_000_000, 'maxRenderedLength')
  const startLine = options.startLine ?? options.highlight?.startLine ?? 1
  if (!Number.isSafeInteger(startLine) || startLine < 1) throw new RangeError('startLine must be a positive safe integer')
  const states = new WeakMap<Readonly<CodeToken>, Presentation>()
  const stateFor = (context: CodeBlockContext): Presentation => {
    const state = states.get(context.token)
    if (!state) throw new Error('Missing code presentation context')
    return state
  }
  const preAttributes = (state: Presentation): HighlightRenderAttributes => ({
    class: `${prefix}-source`, attributes: { tabindex: 0, role: 'region', 'aria-label': state.label },
  })
  const renderPlain = (_token: CodeToken, context?: CodeBlockContext): string => {
    const state = stateFor(context!)
    let length = 0
    let sourceOffset = 0
    const lines = state.lines.map((text, index) => {
      const line = index + 1
      const displayLine = state.startLine + index
      const diff = state.removed.has(line) ? 'removed' : state.added.has(line) ? 'added' : state.modified.has(line) ? 'modified' : undefined
      const addition = lineAttributes(state, prefix, line, displayLine, diff)
      const attrs = Object.entries(addition.attributes!).filter(([, value]) => value !== undefined).map(([key, value]) => ` ${key}="${escape(String(value))}"`).join('')
      const gutter = diff ? `<span class="${prefix}-gutter" aria-hidden="true">${diff === 'added' ? '+' : diff === 'removed' ? '-' : '~'}</span>` : ''
      const number = state.lineNumbers ? `<span class="${prefix}-number" aria-hidden="true">${displayLine}</span>` : ''
      const content = renderCodeWordRanges(text, sourceOffset, state.wordRanges, prefix)
      sourceOffset += text.length
      sourceOffset += state.source.startsWith('\r\n', sourceOffset) ? 2 : /[\r\n]/.test(state.source[sourceOffset] ?? '') ? 1 : 0
      const html = `<span class="${prefix}-source-line ${(addition.class as string[]).join(' ')}"${attrs}>${gutter}${number}<span class="${prefix}-source-line-content">${content}</span></span>`
      length += html.length
      checkSize(length, maxRenderedLength, 'maxRenderedLength')
      return html
    }).join('')
    const lang = context?.language ? ` data-language="${escape(context.language)}"` : ''
    return `<pre class="${prefix}-source" tabindex="0" role="region" aria-label="${escape(state.label)}"${lang}><code>${lines}</code></pre>\n`
  }
  const highlight = options.highlight
  const highlighter = highlight && createHighlightRenderer({
    ...highlight,
    renderOptions(context) {
      const state = stateFor(context)
      const selected = highlight.renderOptions?.(context)
      if (selected !== undefined && (!selected || typeof selected !== 'object' || Array.isArray(selected) || 'then' in selected)) throw new TypeError('renderOptions must return synchronous options or undefined')
      const hooks = selected?.hooks ?? highlight.hooks
      // Retain hook validation even though the presentation adds its own callbacks.
      if (hooks !== undefined) {
        if (!hooks || typeof hooks !== 'object') throw new TypeError('hooks must be an object')
        for (const key of ['token', 'line', 'code', 'pre'] as const) {
          if (hooks[key] !== undefined && typeof hooks[key] !== 'function') throw new TypeError(`hooks.${key} must be a function`)
        }
      }
      const diff = selected?.diffHighlight ?? (typeof highlight.diffHighlight === 'function' ? highlight.diffHighlight(context.token) : highlight.diffHighlight)
      const merged = mergeDiff(state, diff)
      state.added = new Set(merged.added)
      state.removed = new Set(merged.removed)
      state.modified = new Set(merged.modified)
      if (selected?.highlightLines) state.highlights = new Set(selected.highlightLines)
      const composed: HighlightRenderHooks = {
        ...hooks,
        line: (line: HighlightLineRenderContext) => combine(lineAttributes(state, prefix, line.line, line.displayLine,
          line.removed ? 'removed' : line.added ? 'added' : line.modified ? 'modified' : undefined), hooks?.line?.(line)),
        pre: line => combine(preAttributes(state), hooks?.pre?.(line)),
      }
      return { ...selected, lineNumbers: selected?.lineNumbers ?? state.lineNumbers, startLine: selected?.startLine ?? state.startLine,
        highlightRanges: selected?.highlightRanges ?? (state.hasWordMetadata ? state.wordRanges : highlight.highlightRanges),
        diffHighlight: merged, hooks: composed }
    },
  }, renderPlain, false)

  return builder => {
    builder.setRenderer('code', (token, suppliedContext) => {
      const context = suppliedContext ?? createCodeBlockContext(token)
      checkSize(context.source.length, maxInputLength, 'maxInputLength')
      checkSize(context.lineCount + (/[\r\n]$/.test(context.source) || !context.source.length ? 1 : 0), maxLines, 'maxLines')
      const state = readPresentation(context, options.lineNumbers ?? highlight?.lineNumbers ?? false, startLine)
      if (!Number.isSafeInteger(state.startLine + state.lines.length - 1)) throw new RangeError('Displayed line exceeds the safe integer range')
      if (state.diagnostics.length) options.onDiagnostic?.(Object.freeze(state.diagnostics.map(d => Object.freeze(d))), context)
      const document = builder.document
      if (document) {
        document.addStylesheet({ id: `neo.markdown:code-presentation:${prefix}`, css: presentationStyles ??= getCodePresentationStyles({ classPrefix: prefix }) })
        for (const diagnostic of getCodeBlockMetadata(context).diagnostics) {
          document.reportDiagnostic({ source: 'code-metadata', code: diagnostic.code, severity: 'warning',
            message: diagnostic.message, metaRange: { start: diagnostic.start, end: diagnostic.end } })
        }
        for (const diagnostic of state.diagnostics) {
          if (diagnostic.field !== 'metadata') document.reportDiagnostic({ source: 'code-presentation', code: 'invalid-field', severity: 'warning',
            message: diagnostic.message, field: diagnostic.field })
        }
      }
      const cleanToken = { ...token, text: state.source }
      const cleanContext = createCodeBlockContext(cleanToken)
      states.set(cleanContext.token, state)
      const code = highlighter ? highlighter.code(cleanToken, cleanContext, document) : renderPlain(cleanToken, cleanContext)
      const caption = [state.caption ? `<span class="${prefix}-title">${escape(state.caption)}</span>` : '', state.filename ? `<span class="${prefix}-filename">${escape(state.filename)}</span>` : ''].filter(Boolean).join(' — ')
      const legend = state.added.size || state.removed.size || state.modified.size
        ? `<span class="${prefix}-legend">+ added · − removed · ~ modified</span>` : ''
      const html = `<figure class="${prefix}${legend ? ` ${prefix}-has-diff` : ''}">${caption ? `<figcaption class="${prefix}-caption">${caption}</figcaption>` : ''}${legend}${code}</figure>\n`
      checkSize(html.length, maxRenderedLength, 'maxRenderedLength')
      return html
    })
    const css = options.injectStyles === false ? '' : `<style>${presentationStyles ??= getCodePresentationStyles({ classPrefix: prefix })}</style>`
    if (css || highlighter?.styles) builder.addHtmlTransform(html => builder.document ? html : css + (highlighter?.styles ?? '') + html)
  }
}
