/**
 * Copy-to-clipboard button plugin for neo.markdown.
 *
 * The plugin emits inert HTML only. Call initializeCopyCode() from client code
 * after the rendered document is mounted. This works with strict script CSPs
 * and with HTML inserted through innerHTML or React dangerouslySetInnerHTML.
 */

import type { MarkdownPlugin } from '../core/types.js'
import { escape } from '../utils/escape.js'

export interface CopyCodeOptions {
  /** Button text (default: "Copy") */
  buttonText?: string
  /** Button text after copying (default: "Copied!") */
  copiedText?: string
  /** CSS class for the button (default: "copy-code-button") */
  buttonClass?: string
  /** CSS class for the wrapper div (default: "code-block") */
  wrapperClass?: string
  /** Inject default CSS styles (default: true). Disable for strict style CSPs. */
  injectStyles?: boolean
}

export interface CopyCodeInitializerOptions {
  /** Event delegation root (default: document) */
  root?: Document | HTMLElement
  /** Milliseconds before restoring the original label (default: 2000) */
  resetDelay?: number
  /** Receives clipboard errors. The button keeps its original label on failure. */
  onError?: (error: unknown) => void
}

/** Read Neo line content without its presentation-only numbers and diff gutters. */
function getCodeText(code: HTMLElement): string {
  const pre = code.closest('pre')
  if (pre && code.childNodes.length > 0) {
    for (const prefix of pre.classList) {
      const lines: string[] = []
      const sourceLines = code.firstElementChild?.classList.contains(`${prefix}-line-source`) === true
      let matched = 0
      for (const node of code.childNodes) {
        if (!(node instanceof Element) || !node.classList.contains(`${prefix}-line`)) break
        if (node.classList.contains(`${prefix}-line-source`) !== sourceLines) break
        const content = Array.from(node.children).find((child) => child.classList.contains(`${prefix}-line-content`))
        if (!content) break
        matched++
        if (node.getAttribute('data-copy-code-exclude') !== 'true') lines.push(content.textContent ?? '')
      }
      if (matched === code.childNodes.length) return lines.join(sourceLines ? '' : '\n')
    }
  }
  return code.textContent ?? ''
}

const CSS_CLASS_RE = /^-?[_a-zA-Z]+[_a-zA-Z\d-]*$/

function validateClassName(name: string, value: string): string {
  if (!CSS_CLASS_RE.test(value)) {
    throw new TypeError(`${name} must be a single valid CSS class name`)
  }
  return value
}

function wrapOpeningPreTags(html: string, wrapper: string): string {
  const chunks: string[] = []
  let cursor = 0

  while (cursor < html.length) {
    const opening = html.indexOf('<pre', cursor)
    if (opening === -1) break

    const boundary = html[opening + 4]
    if (boundary !== undefined && /[A-Za-z\d_]/.test(boundary)) {
      chunks.push(html.slice(cursor, opening + 4))
      cursor = opening + 4
      continue
    }

    const closing = html.indexOf('>', opening + 4)
    if (closing === -1) break
    chunks.push(html.slice(cursor, opening), wrapper, html.slice(opening, closing + 1))
    cursor = closing + 1
  }

  if (cursor === 0) return html
  chunks.push(html.slice(cursor))
  return chunks.join('')
}

/** Return the default stylesheet so applications can serve it as a CSP-safe asset. */
export function getCopyCodeStyles(options: Pick<CopyCodeOptions, 'buttonClass' | 'wrapperClass'> = {}): string {
  const wrapperClass = validateClassName('wrapperClass', options.wrapperClass ?? 'code-block')
  const buttonClass = validateClassName('buttonClass', options.buttonClass ?? 'copy-code-button')

  return `.${wrapperClass}{position:relative}
.${buttonClass}{position:absolute;top:8px;right:8px;padding:4px 8px;font-size:12px;line-height:1;font-family:inherit;color:inherit;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.15);border-radius:4px;cursor:pointer;opacity:0;transition:opacity .15s;z-index:1}
.${wrapperClass}:hover .${buttonClass},.${wrapperClass}:focus-within .${buttonClass}{opacity:1}
.${buttonClass}:focus-visible{outline:2px solid currentColor;outline-offset:2px}
.${buttonClass}:hover{background:rgba(255,255,255,.2)}`
}

export interface CopyCodeController {
  (): void
  /** Cancel pending feedback and reset current controls after their scope's DOM changes. */
  refresh(): void
}

/**
 * Install one delegated click handler for copy-code buttons.
 *
 * @returns A cleanup function with a refresh method. Both are no-ops on the server.
 */
export function initializeCopyCode(options: CopyCodeInitializerOptions = {}): CopyCodeController {
  if (typeof document === 'undefined') return Object.assign(() => undefined, { refresh() {} })

  const root = options.root ?? document
  const resetDelay = Number.isFinite(options.resetDelay) && (options.resetDelay ?? 0) >= 0
    ? options.resetDelay ?? 2000
    : 2000
  const timers = new Map<HTMLButtonElement, { timer: ReturnType<typeof setTimeout>; originalText: string }>()
  let disposed = false
  let revision = 0

  const onClick = (event: Event): void => {
    if (disposed || !(event.target instanceof Element)) return
    const button = event.target.closest<HTMLButtonElement>('button[data-copy-code]')
    if (!button) return

    const wrapper = button.closest<HTMLElement>('[data-copy-code-wrapper]')
    const code = wrapper?.querySelector<HTMLElement>('pre code') ?? wrapper?.querySelector<HTMLElement>('pre')
    if (!code || typeof navigator === 'undefined' || !navigator.clipboard) return

    const originalText = button.dataset['copyText'] ?? timers.get(button)?.originalText ?? button.textContent ?? 'Copy'
    const copiedText = button.dataset['copiedText'] ?? 'Copied!'

    const text = getCodeText(code)
    const requestedRevision = revision
    void Promise.resolve().then(() => navigator.clipboard.writeText(text)).then(
      () => {
        if (disposed || requestedRevision !== revision || !root.contains(button)) return
        const feedback = timers.get(button)
        if (feedback !== undefined) clearTimeout(feedback.timer)
        button.textContent = copiedText
        timers.set(button, { originalText, timer: setTimeout(() => {
          timers.delete(button)
          button.textContent = originalText
        }, resetDelay) })
      },
      (error: unknown) => {
        if (!disposed && requestedRevision === revision && root.contains(button)) options.onError?.(error)
      }
    )
  }

  root.addEventListener('click', onClick)
  function refresh() {
    revision++
    for (const [button, feedback] of timers) {
      clearTimeout(feedback.timer)
      if (root.contains(button)) button.textContent = button.dataset['copyText'] ?? feedback.originalText
    }
    timers.clear()
  }
  const dispose = () => {
    disposed = true
    root.removeEventListener('click', onClick)
    refresh()
  }
  return Object.assign(dispose, { refresh })
}

export function copyCodePlugin(options: CopyCodeOptions = {}): MarkdownPlugin {
  const buttonText = options.buttonText ?? 'Copy'
  const copiedText = options.copiedText ?? 'Copied!'
  const buttonClass = validateClassName('buttonClass', options.buttonClass ?? 'copy-code-button')
  const wrapperClass = validateClassName('wrapperClass', options.wrapperClass ?? 'code-block')
  const injectStyles = options.injectStyles ?? true

  const button = (
    `<button class="${buttonClass}" type="button" data-copy-code` +
    ` data-copy-text="${escape(buttonText)}" data-copied-text="${escape(copiedText)}">` +
    `${escape(buttonText)}</button>`
  )

  return (builder) => {
    builder.addHtmlTransform((html) => {
      const wrapped = wrapOpeningPreTags(
        html,
        `<div class="${wrapperClass}" data-copy-code-wrapper>${button}`
      )
      let result = wrapped.replace(
          /<\/pre>(\n?)/g,
          `</pre></div>$1`
        )

      const needsStyles = builder.document ? wrapped !== html : result.includes('data-copy-code-wrapper')
      if ((injectStyles || builder.document) && needsStyles) {
        const css = getCopyCodeStyles({ wrapperClass, buttonClass })
        if (builder.document) builder.document.addStylesheet({ id: `neo.markdown:copy-code:${wrapperClass}:${buttonClass}`, css })
        else result = `<style>${css}</style>${result}`
      }

      return result
    })
  }
}
