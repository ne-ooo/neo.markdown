import { createRequire } from 'node:module'
import { isMainThread, parentPort, workerData } from 'node:worker_threads'
const require = createRequire(import.meta.url)
const load = specifier => process.env.NEO_INTEGRATION_FORMAT === 'cjs' ? require(specifier) : import(specifier)
const { installMarkdownWorker } = await load('@lpm.dev/neo.markdown/experimental/worker')
const { defineIncrementalPlugin } = await load('@lpm.dev/neo.markdown/experimental')
const { codePresentationPlugin } = await load('@lpm.dev/neo.markdown/plugins/code-presentation')
const { tocPlugin } = await load('@lpm.dev/neo.markdown/plugins/toc')
const { copyCodePlugin } = await load('@lpm.dev/neo.markdown/plugins/copy-code')
const { embedPlugin } = await load('@lpm.dev/neo.markdown/plugins/embeds')
const { sanitizeHtml } = await load('@lpm.dev/neo.markdown/sanitized')
const { tokenize, renderToHTML, getThemeStylesheet } = await load('@lpm.dev/neo.highlight')
const { javascript, typescript, python, css } = await load('@lpm.dev/neo.highlight/grammars')
const { dracula } = await load('@lpm.dev/neo.highlight/themes/dracula')
export function parserOptions(configuration = {}) {
  configuration ??= {}
  const declare = (plugin, id) => defineIncrementalPlugin(plugin, { protocol: 1, id, profile: 'render' })
  const plugins = [declare(codePresentationPlugin({ injectStyles: false, highlight: {
    tokenize, renderToHTML, getThemeStylesheet, grammars: [javascript, typescript, python, css], theme: dracula,
    injectStyles: false, styleMode: 'class', errorPolicy: 'plain',
  } }), 'presentation'), declare(tocPlugin({ anchorLinks: true }), 'toc'), declare(copyCodePlugin({ injectStyles: false }), 'copy')]
  if (configuration.embeds) plugins.push(embedPlugin({ youtube: true, consent: true }))
  if (configuration.block) plugins.push(builder => builder.addHtmlTransform(html => {
    if (html.includes('BLOCK')) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0)
    return html
  }))
  return { gfm: true, allowHtml: true, sanitize: true, sanitizer: sanitizeHtml, plugins }
}
if (!isMainThread) {
  const listeners = new Map()
  installMarkdownWorker({
    addEventListener(type, listener) {
      const wrapped = data => {
        if (data.type === 'update' && data.source.includes('BLOCK') && workerData?.block) parentPort.postMessage({ test: 'entered' })
        listener({ data })
      }
      listeners.set(listener, wrapped); parentPort.on(type, wrapped)
    },
    removeEventListener(type, listener) { parentPort.off(type, listeners.get(listener)); listeners.delete(listener) },
    postMessage: data => parentPort.postMessage(data),
  }, { maxUpdates: workerData?.maxUpdates ?? 1000, configure: configuration => ({ session: { parser: parserOptions(configuration), pluginReuse: 'declared' } }) })
}
