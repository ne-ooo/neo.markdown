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
.${wrapperClass}:hover .${buttonClass}{opacity:1}
.${buttonClass}:hover{background:rgba(255,255,255,.2)}`
}

/**
 * Install one delegated click handler for copy-code buttons.
 *
 * @returns A cleanup function. On the server, the cleanup is a no-op.
 */
export function initializeCopyCode(options: CopyCodeInitializerOptions = {}): () => void {
  if (typeof document === 'undefined') return () => undefined

  const root = options.root ?? document
  const resetDelay = Number.isFinite(options.resetDelay) && (options.resetDelay ?? 0) >= 0
    ? options.resetDelay ?? 2000
    : 2000

  const onClick = (event: Event): void => {
    if (!(event.target instanceof Element)) return
    const button = event.target.closest<HTMLButtonElement>('button[data-copy-code]')
    if (!button) return

    const wrapper = button.closest<HTMLElement>('[data-copy-code-wrapper]')
    const code = wrapper?.querySelector<HTMLElement>('pre code, pre')
    if (!code || typeof navigator === 'undefined' || !navigator.clipboard) return

    const originalText = button.dataset['copyText'] ?? button.textContent ?? 'Copy'
    const copiedText = button.dataset['copiedText'] ?? 'Copied!'

    void navigator.clipboard.writeText(code.textContent ?? '').then(() => {
      button.textContent = copiedText
      globalThis.setTimeout(() => {
        button.textContent = originalText
      }, resetDelay)
    })
  }

  root.addEventListener('click', onClick)
  return () => root.removeEventListener('click', onClick)
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
      let result = wrapOpeningPreTags(
        html,
        `<div class="${wrapperClass}" data-copy-code-wrapper>${button}`
      )
        .replace(
          /<\/pre>(\n?)/g,
          `</pre></div>$1`
        )

      if (injectStyles && result.includes('data-copy-code-wrapper')) {
        result = `<style>${getCopyCodeStyles({ wrapperClass, buttonClass })}</style>${result}`
      }

      return result
    })
  }
}
