/**
 * Copy-to-clipboard button plugin for neo.markdown
 *
 * Injects a copy button into `<pre>` code blocks via HTML transform.
 *
 * @example
 * ```typescript
 * import { copyCodePlugin } from '@lpm.dev/neo.markdown/plugins/copy-code'
 *
 * const html = parse(markdown, {
 *   plugins: [copyCodePlugin()]
 * })
 * ```
 */

import type { MarkdownPlugin } from '../core/types.js'

/**
 * Copy-code plugin options
 */
export interface CopyCodeOptions {
  /** Button text (default: "Copy") */
  buttonText?: string
  /** CSS class for the button (default: "copy-code-button") */
  buttonClass?: string
  /** CSS class for the wrapper div (default: "code-block") */
  wrapperClass?: string
}

/**
 * Create the copy-code plugin
 *
 * @param options - Copy-code options
 * @returns Markdown plugin
 */
export function copyCodePlugin(options: CopyCodeOptions = {}): MarkdownPlugin {
  const {
    buttonText = 'Copy',
    buttonClass = 'copy-code-button',
    wrapperClass = 'code-block',
  } = options

  const button = `<button class="${buttonClass}" type="button">${buttonText}</button>`

  return (builder) => {
    builder.addHtmlTransform((html) =>
      html.replace(
        /<pre>/g,
        `<div class="${wrapperClass}">${button}<pre>`
      ).replace(
        /<\/pre>\n/g,
        `</pre></div>\n`
      )
    )
  }
}
