/**
 * Copy-to-clipboard button plugin for neo.markdown
 *
 * Injects a copy button into `<pre>` code blocks via HTML transform.
 * Includes default styles (absolute top-right positioning) and a small
 * inline script for click-to-copy functionality.
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
  /** Button text after copying (default: "Copied!") */
  copiedText?: string
  /** CSS class for the button (default: "copy-code-button") */
  buttonClass?: string
  /** CSS class for the wrapper div (default: "code-block") */
  wrapperClass?: string
  /** Inject default CSS styles (default: true) */
  injectStyles?: boolean
}

const defaultStyles = (wrapperClass: string, buttonClass: string) => `<style>
.${wrapperClass}{position:relative}
.${buttonClass}{position:absolute;top:8px;right:8px;padding:4px 8px;font-size:12px;line-height:1;font-family:inherit;color:inherit;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.15);border-radius:4px;cursor:pointer;opacity:0;transition:opacity .15s;z-index:1}
.${wrapperClass}:hover .${buttonClass}{opacity:1}
.${buttonClass}:hover{background:rgba(255,255,255,.2)}
</style>`

/**
 * Create the copy-code plugin
 *
 * @param options - Copy-code options
 * @returns Markdown plugin
 */
export function copyCodePlugin(options: CopyCodeOptions = {}): MarkdownPlugin {
  const {
    buttonText = 'Copy',
    copiedText = 'Copied!',
    buttonClass = 'copy-code-button',
    wrapperClass = 'code-block',
    injectStyles = true,
  } = options

  const button = `<button class="${buttonClass}" type="button">${buttonText}</button>`

  const copyScript = `<script>
(function(){
  if(typeof document==='undefined')return;
  var bt='${buttonText}',ct='${copiedText}';
  document.addEventListener('click',function(e){
    var b=e.target.closest('.${buttonClass}');
    if(!b)return;
    var pre=b.closest('.${wrapperClass}');
    if(!pre)return;
    var code=pre.querySelector('pre code')||pre.querySelector('pre');
    if(!code)return;
    navigator.clipboard.writeText(code.textContent||'').then(function(){
      b.textContent=ct;
      setTimeout(function(){b.textContent=bt},2000);
    });
  });
})();
</script>`

  let injected = false

  return (builder) => {
    builder.addHtmlTransform((html) => {
      // Match <pre> with or without attributes (class, data-language, etc.)
      let result = html
        .replace(
          /<pre\b([^>]*)>/g,
          `<div class="${wrapperClass}">${button}<pre$1>`
        )
        .replace(
          /<\/pre>(\n?)/g,
          `</pre></div>$1`
        )

      // Inject styles and script once
      if (!injected && result.includes(wrapperClass)) {
        injected = true
        if (injectStyles) {
          result = defaultStyles(wrapperClass, buttonClass) + result
        }
        result += copyScript
      }

      return result
    })
  }
}
