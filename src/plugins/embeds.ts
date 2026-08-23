/**
 * Embed plugin for neo.markdown
 *
 * Supports: YouTube, Vimeo, Twitter/X, CodeSandbox, CodePen, GitHub Gist, Loom
 * via directive syntax and bare-URL auto-embed.
 *
 * @example
 * ```typescript
 * import { embedPlugin } from '@lpm.dev/neo.markdown/plugins/embeds'
 *
 * const html = parse(markdown, {
 *   plugins: [
 *     embedPlugin({
 *       youtube: { privacyEnhanced: true },
 *       twitter: true,
 *       vimeo: true,
 *       codesandbox: true,
 *       codepen: true,
 *       gist: true,
 *       loom: true,
 *       autoEmbed: true,
 *     })
 *   ]
 * })
 * ```
 *
 * Directive syntax:
 * ```markdown
 * ::youtube[dQw4w9WgXcQ]
 * ::tweet[1234567890]
 * ::vimeo[53373707]{title="My Video"}
 * ::codesandbox[my-sandbox-id]
 * ::codepen[pen-id]{user="username"}
 * ::gist[gist-hash]{user="username"}
 * ::loom[video-hash]
 * ```
 *
 * Auto-embed: A paragraph containing only a supported URL becomes an embed.
 */

import type { MarkdownPlugin, DirectiveToken } from '../core/types.js'
import { matchEmbedUrl, type UrlMatch } from '../utils/url-patterns.js'
import { escape } from '../utils/escape.js'

/**
 * YouTube embed options
 */
export interface YouTubeOptions {
  /** Use privacy-enhanced mode (youtube-nocookie.com) — default: true */
  privacyEnhanced?: boolean
  /** Add loading="lazy" to iframe — default: true */
  lazyLoad?: boolean
}

/**
 * Vimeo embed options
 */
export interface VimeoOptions {
  /** Enable Do Not Track mode (?dnt=1) — default: true */
  dnt?: boolean
  /** Add loading="lazy" to iframe — default: true */
  lazyLoad?: boolean
}

/**
 * Twitter/X embed options
 */
export interface TwitterOptions {
  /** Enable Do Not Track (data-dnt="true") — default: true */
  dnt?: boolean
  /** Theme for the embed (data-theme) */
  theme?: 'light' | 'dark'
}

/**
 * Embed plugin options
 */
export interface EmbedOptions {
  /** Enable YouTube embeds (true or options object) */
  youtube?: boolean | YouTubeOptions
  /** Enable Vimeo embeds (true or options object) */
  vimeo?: boolean | VimeoOptions
  /** Enable Twitter/X embeds (true or options object) */
  twitter?: boolean | TwitterOptions
  /** Enable CodeSandbox embeds */
  codesandbox?: boolean
  /** Enable CodePen embeds */
  codepen?: boolean
  /** Enable GitHub Gist embeds */
  gist?: boolean
  /** Enable Loom video embeds */
  loom?: boolean
  /** Auto-embed bare URLs in paragraphs (default: false) */
  autoEmbed?: boolean
  /** Wrap in responsive 16:9 container (default: true) */
  responsive?: boolean
  /** GDPR consent mode — show placeholder instead of iframe until user clicks (default: false) */
  consent?: boolean
  /** Custom consent message (default: "Click to load external content") */
  consentMessage?: string
}

export interface EmbedInitializerOptions {
  /** Event delegation and embed discovery root (default: document). */
  root?: Document | HTMLElement
}

interface TwitterWidgetsApi {
  widgets?: {
    load(root?: HTMLElement | Document): void
  }
}

interface ConsentPayload {
  provider: UrlMatch['provider']
  id: string
  attributes: Record<string, string>
  responsive: boolean
  youtubeOptions?: YouTubeOptions
  vimeoOptions?: VimeoOptions
  twitterOptions?: TwitterOptions
}

const TWITTER_WIDGETS_SRC = 'https://platform.twitter.com/widgets.js'

function createMarkerNonce(): string {
  const values = new Uint32Array(4)
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(values)
    return [...values].map((value) => value.toString(36)).join('')
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`
}

/**
 * Directive pattern: ::name[label]{key="value" ...}
 */
const DIRECTIVE_PATTERN = /^::(\w+)\[([^\]]*)\](?:\{([^}]*)\})?(?:\n|$)/

/**
 * Parse directive attributes from string like: title="My Video" width="100%"
 */
function parseAttributes(attrStr?: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  if (!attrStr) return attrs

  const regex = /(\w+)="([^"]*)"/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(attrStr)) !== null) {
    attrs[match[1]] = match[2]
  }
  return attrs
}

/**
 * Render a YouTube embed with responsive container, privacy mode, and accessibility
 */
function renderYouTube(id: string, attrs: Record<string, string>, options: YouTubeOptions, responsive: boolean): string {
  const privacyEnhanced = options.privacyEnhanced !== false // default: true
  const lazyLoad = options.lazyLoad !== false // default: true
  const domain = privacyEnhanced ? 'www.youtube-nocookie.com' : 'www.youtube.com'
  const title = attrs['title'] ?? 'YouTube video'
  const src = `https://${domain}/embed/${escape(id)}`
  const loading = lazyLoad ? ' loading="lazy"' : ''

  if (responsive) {
    return (
      `<div class="embed embed-youtube" style="position:relative;width:100%;padding-bottom:56.25%;overflow:hidden;border-radius:8px;background:#1a1a1a">` +
      `<iframe src="${src}" title="${escape(title)}"${loading} ` +
      `allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" ` +
      `allowfullscreen ` +
      `style="position:absolute;top:0;left:0;width:100%;height:100%;border:none"></iframe>` +
      `</div>\n`
    )
  }

  const width = attrs['width'] ?? '100%'
  const height = attrs['height'] ?? '315'
  return (
    `<div class="embed embed-youtube">` +
    `<iframe width="${escape(width)}" height="${escape(height)}" ` +
    `src="${src}" title="${escape(title)}"${loading} ` +
    `allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" ` +
    `allowfullscreen style="border:none"></iframe>` +
    `</div>\n`
  )
}

/**
 * Render a Vimeo embed with DNT, responsive container, and accessibility
 */
function renderVimeo(id: string, attrs: Record<string, string>, options: VimeoOptions, responsive: boolean): string {
  const dnt = options.dnt !== false // default: true
  const lazyLoad = options.lazyLoad !== false // default: true
  const title = attrs['title'] ?? 'Vimeo video'
  const dntParam = dnt ? '?dnt=1' : ''
  const src = `https://player.vimeo.com/video/${escape(id)}${dntParam}`
  const loading = lazyLoad ? ' loading="lazy"' : ''

  if (responsive) {
    return (
      `<div class="embed embed-vimeo" style="position:relative;width:100%;padding-bottom:56.25%;overflow:hidden;border-radius:8px;background:#1a1a1a">` +
      `<iframe src="${src}" title="${escape(title)}"${loading} ` +
      `allow="autoplay; fullscreen; picture-in-picture" ` +
      `allowfullscreen ` +
      `style="position:absolute;top:0;left:0;width:100%;height:100%;border:none"></iframe>` +
      `</div>\n`
    )
  }

  const width = attrs['width'] ?? '100%'
  const height = attrs['height'] ?? '315'
  return (
    `<div class="embed embed-vimeo">` +
    `<iframe width="${escape(width)}" height="${escape(height)}" ` +
    `src="${src}" title="${escape(title)}"${loading} ` +
    `allow="autoplay; fullscreen; picture-in-picture" ` +
    `allowfullscreen style="border:none"></iframe>` +
    `</div>\n`
  )
}

/**
 * Render a Twitter/X embed with privacy, theme support, and fallback link
 */
function renderTweet(id: string, options: TwitterOptions): string {
  const dnt = options.dnt !== false // default: true
  const dntAttr = dnt ? ' data-dnt="true"' : ''
  const themeAttr = options.theme ? ` data-theme="${escape(options.theme)}"` : ''
  const escapedId = escape(id)

  return (
    `<div class="embed embed-twitter">` +
    `<blockquote class="twitter-tweet"${dntAttr}${themeAttr}>` +
    `<a href="https://twitter.com/i/status/${escapedId}">Loading tweet...</a>` +
    `</blockquote>` +
    `</div>\n`
  )
}

/**
 * Render a CodeSandbox embed with responsive container
 */
function renderCodeSandbox(id: string, attrs: Record<string, string>, responsive: boolean): string {
  const title = attrs['title'] ?? 'CodeSandbox'
  const src = `https://codesandbox.io/embed/${escape(id)}?fontsize=14&hidenavigation=1&theme=dark`

  if (responsive) {
    return (
      `<div class="embed embed-codesandbox" style="position:relative;width:100%;padding-bottom:56.25%;overflow:hidden;border-radius:8px;background:#1a1a1a">` +
      `<iframe src="${src}" title="${escape(title)}" loading="lazy" ` +
      `sandbox="allow-same-origin allow-scripts" ` +
      `style="position:absolute;top:0;left:0;width:100%;height:100%;border:none"></iframe>` +
      `</div>\n`
    )
  }

  const width = attrs['width'] ?? '100%'
  const height = attrs['height'] ?? '500'
  return (
    `<div class="embed embed-codesandbox">` +
    `<iframe src="${src}" title="${escape(title)}" width="${escape(width)}" height="${escape(height)}" loading="lazy" ` +
    `sandbox="allow-same-origin allow-scripts" ` +
    `style="border:none"></iframe>` +
    `</div>\n`
  )
}

/**
 * Render a CodePen embed with responsive container
 */
function renderCodePen(id: string, attrs: Record<string, string>, responsive: boolean, user?: string): string {
  const title = attrs['title'] ?? 'CodePen'
  const penUser = attrs['user'] ?? user ?? 'anonymous'
  const src = `https://codepen.io/${escape(penUser)}/embed/${escape(id)}?default-tab=result`

  if (responsive) {
    return (
      `<div class="embed embed-codepen" style="position:relative;width:100%;padding-bottom:56.25%;overflow:hidden;border-radius:8px;background:#1a1a1a">` +
      `<iframe src="${src}" title="${escape(title)}" loading="lazy" ` +
      `sandbox="allow-same-origin allow-scripts" ` +
      `allowfullscreen ` +
      `style="position:absolute;top:0;left:0;width:100%;height:100%;border:none"></iframe>` +
      `</div>\n`
    )
  }

  const width = attrs['width'] ?? '100%'
  const height = attrs['height'] ?? '400'
  return (
    `<div class="embed embed-codepen">` +
    `<iframe src="${src}" title="${escape(title)}" width="${escape(width)}" height="${escape(height)}" loading="lazy" ` +
    `sandbox="allow-same-origin allow-scripts" ` +
    `allowfullscreen style="border:none"></iframe>` +
    `</div>\n`
  )
}

/** Render an inert GitHub Gist marker for the client initializer. */
function renderGist(id: string, attrs: Record<string, string>, user?: string): string {
  const gistUser = attrs['user'] ?? user ?? ''
  const file = attrs['file'] ? `?file=${escape(attrs['file'])}` : ''
  const height = attrs['height'] ?? '400'
  const src = `https://gist.github.com/${escape(gistUser)}/${escape(id)}.js${file}`

  return (
    `<div class="embed embed-gist" data-embed-gist data-gist-src="${src}" data-gist-height="${escape(height)}">` +
    `<noscript><a href="https://gist.github.com/${escape(gistUser)}/${escape(id)}">View Gist on GitHub</a></noscript>` +
    `</div>\n`
  )
}

/**
 * Render a Loom video embed with responsive container
 */
function renderLoom(id: string, attrs: Record<string, string>, responsive: boolean): string {
  const title = attrs['title'] ?? 'Loom video'
  const src = `https://www.loom.com/embed/${escape(id)}`

  if (responsive) {
    return (
      `<div class="embed embed-loom" style="position:relative;width:100%;padding-bottom:56.25%;overflow:hidden;border-radius:8px;background:#1a1a1a">` +
      `<iframe src="${src}" title="${escape(title)}" loading="lazy" ` +
      `allowfullscreen ` +
      `style="position:absolute;top:0;left:0;width:100%;height:100%;border:none"></iframe>` +
      `</div>\n`
    )
  }

  const width = attrs['width'] ?? '100%'
  const height = attrs['height'] ?? '315'
  return (
    `<div class="embed embed-loom">` +
    `<iframe src="${src}" title="${escape(title)}" width="${escape(width)}" height="${escape(height)}" loading="lazy" ` +
    `allowfullscreen style="border:none"></iframe>` +
    `</div>\n`
  )
}

/**
 * Wrap a structured embed payload in an inert GDPR consent placeholder.
 */
function wrapWithConsent(payload: ConsentPayload, message: string): string {
  // Encode UTF-8 bytes rather than passing a Unicode string directly to btoa().
  const bytes = new TextEncoder().encode(JSON.stringify(payload))
  let encoded: string
  if (typeof Buffer !== 'undefined') {
    encoded = Buffer.from(bytes).toString('base64')
  } else {
    let binary = ''
    const chunkSize = 0x8000
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
    }
    encoded = btoa(binary)
  }

  return (
    `<div class="embed embed-consent embed-consent-${escape(payload.provider)}" ` +
    `data-embed-consent data-embed-payload="${encoded}" ` +
    `style="position:relative;width:100%;padding-bottom:56.25%;overflow:hidden;border-radius:8px;background:#1a1a1a;display:flex;align-items:center;justify-content:center">` +
    `<button type="button" data-embed-consent-button ` +
    `style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);padding:12px 24px;border-radius:6px;border:1px solid #444;background:#2a2a2a;color:#e0e0e0;cursor:pointer;font-size:14px;z-index:1" ` +
    `aria-label="${escape(message)} (${escape(payload.provider)})">${escape(message)}</button>` +
    `</div>\n`
  )
}

function getTwitterWidgets(): TwitterWidgetsApi | undefined {
  return (globalThis as typeof globalThis & { twttr?: TwitterWidgetsApi }).twttr
}

function isTrustedGistScript(src: string): boolean {
  try {
    const url = new URL(src)
    return (
      url.protocol === 'https:'
      && url.hostname === 'gist.github.com'
      && url.port === ''
      && !url.username
      && !url.password
      && !url.hash
      && /^\/[A-Za-z\d](?:[A-Za-z\d-]{0,38})\/[\da-f]+\.js$/i.test(url.pathname)
      && [...url.searchParams.keys()].every((key) => key === 'file')
    )
  } catch {
    return false
  }
}

function activateGists(root: ParentNode, ownerDocument: Document): void {
  const gists = root.querySelectorAll<HTMLElement>('[data-embed-gist][data-gist-src]')
  for (const gist of gists) {
    if (gist.getAttribute('data-embed-initialized') === 'true') continue

    const src = gist.getAttribute('data-gist-src') ?? ''
    if (!isTrustedGistScript(src)) continue

    const requestedHeight = Number.parseInt(gist.getAttribute('data-gist-height') ?? '', 10)
    const height = Number.isSafeInteger(requestedHeight) && requestedHeight >= 100 && requestedHeight <= 2_000
      ? String(requestedHeight)
      : '400'
    const frame = ownerDocument.createElement('iframe')
    frame.title = 'GitHub Gist'
    frame.loading = 'lazy'
    frame.setAttribute('width', '100%')
    frame.setAttribute('height', height)
    frame.setAttribute('sandbox', 'allow-scripts')
    frame.setAttribute('referrerpolicy', 'no-referrer')
    frame.setAttribute('data-neo-embed-gist', '')
    frame.srcdoc = `<!doctype html><meta charset="utf-8"><script src="${escape(src)}"></script>`
    gist.setAttribute('data-embed-initialized', 'true')
    gist.appendChild(frame)
  }
}

function activateTweets(root: ParentNode, ownerDocument: Document): void {
  if (!root.querySelector('.twitter-tweet')) return

  const twitter = getTwitterWidgets()
  if (twitter?.widgets?.load) {
    twitter.widgets.load(root as HTMLElement | Document)
    return
  }

  const existingScript = ownerDocument.querySelector<HTMLScriptElement>(
    `script[data-neo-embed-twitter],script[src="${TWITTER_WIDGETS_SRC}"]`
  )
  if (existingScript) {
    if (existingScript.hasAttribute('data-neo-embed-twitter-listener')) return
    existingScript.setAttribute('data-neo-embed-twitter-listener', '')
    existingScript.addEventListener('load', () => {
      getTwitterWidgets()?.widgets?.load(root as HTMLElement | Document)
    }, { once: true })
    return
  }

  const script = ownerDocument.createElement('script')
  script.src = TWITTER_WIDGETS_SRC
  script.async = true
  script.setAttribute('data-neo-embed-twitter', '')
  script.setAttribute('data-neo-embed-twitter-listener', '')
  script.addEventListener('load', () => {
    getTwitterWidgets()?.widgets?.load(root as HTMLElement | Document)
  }, { once: true })
  ownerDocument.head.appendChild(script)
}

function activateEmbedMarkup(root: ParentNode, ownerDocument: Document): void {
  activateGists(root, ownerDocument)
  activateTweets(root, ownerDocument)
}

function decodeBase64Utf8(encoded: string): string | null {
  if (typeof globalThis.atob !== 'function') return null
  try {
    const binary = globalThis.atob(encoded)
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
    return new TextDecoder().decode(bytes)
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseAttributesPayload(value: unknown): Record<string, string> | null {
  if (!isRecord(value) || Object.keys(value).length > 32) return null

  const attributes: Record<string, string> = Object.create(null) as Record<string, string>
  for (const [name, attributeValue] of Object.entries(value)) {
    if (!/^\w{1,64}$/.test(name) || typeof attributeValue !== 'string' || attributeValue.length > 2_048) {
      return null
    }
    attributes[name] = attributeValue
  }
  return attributes
}

function parseConsentPayload(encoded: string): ConsentPayload | null {
  const json = decodeBase64Utf8(encoded)
  if (json === null || json.length > 16_384) return null

  try {
    const value: unknown = JSON.parse(json)
    if (!isRecord(value) || typeof value['id'] !== 'string' || value['id'].length > 2_048) {
      return null
    }

    const provider = value['provider']
    if (
      provider !== 'youtube'
      && provider !== 'vimeo'
      && provider !== 'twitter'
      && provider !== 'codesandbox'
      && provider !== 'codepen'
      && provider !== 'gist'
      && provider !== 'loom'
    ) {
      return null
    }

    const attributes = parseAttributesPayload(value['attributes'])
    if (!attributes || typeof value['responsive'] !== 'boolean') return null

    const payload: ConsentPayload = {
      provider,
      id: value['id'],
      attributes,
      responsive: value['responsive'],
    }

    if (provider === 'youtube') {
      if (!isRecord(value['youtubeOptions'])) return null
      const privacyEnhanced = value['youtubeOptions']['privacyEnhanced']
      const lazyLoad = value['youtubeOptions']['lazyLoad']
      if (privacyEnhanced !== undefined && typeof privacyEnhanced !== 'boolean') return null
      if (lazyLoad !== undefined && typeof lazyLoad !== 'boolean') return null
      payload.youtubeOptions = { privacyEnhanced, lazyLoad }
    } else if (provider === 'vimeo') {
      if (!isRecord(value['vimeoOptions'])) return null
      const dnt = value['vimeoOptions']['dnt']
      const lazyLoad = value['vimeoOptions']['lazyLoad']
      if (dnt !== undefined && typeof dnt !== 'boolean') return null
      if (lazyLoad !== undefined && typeof lazyLoad !== 'boolean') return null
      payload.vimeoOptions = { dnt, lazyLoad }
    } else if (provider === 'twitter') {
      if (!isRecord(value['twitterOptions'])) return null
      const dnt = value['twitterOptions']['dnt']
      const theme = value['twitterOptions']['theme']
      if (dnt !== undefined && typeof dnt !== 'boolean') return null
      if (theme !== undefined && theme !== 'light' && theme !== 'dark') return null
      payload.twitterOptions = { dnt, theme }
    }

    return payload
  } catch {
    return null
  }
}

function renderConsentPayload(payload: ConsentPayload): string {
  const { provider, id, attributes, responsive } = payload
  if (provider === 'youtube') return renderYouTube(id, attributes, payload.youtubeOptions ?? {}, responsive)
  if (provider === 'vimeo') return renderVimeo(id, attributes, payload.vimeoOptions ?? {}, responsive)
  if (provider === 'twitter') return renderTweet(id, payload.twitterOptions ?? {})
  if (provider === 'codesandbox') return renderCodeSandbox(id, attributes, responsive)
  if (provider === 'codepen') return renderCodePen(id, attributes, responsive, attributes['user'])
  if (provider === 'gist') return renderGist(id, attributes, attributes['user'])
  return renderLoom(id, attributes, responsive)
}

/**
 * Activate consent buttons, Gist scripts, and Twitter widgets.
 *
 * @returns A cleanup function. On the server, the cleanup is a no-op.
 */
export function initializeEmbeds(options: EmbedInitializerOptions = {}): () => void {
  if (typeof document === 'undefined') return () => undefined

  const root = options.root ?? document
  const ownerDocument = 'createElement' in root ? root : root.ownerDocument
  activateEmbedMarkup(root, ownerDocument)

  const onClick = (event: Event): void => {
    const target = event.target as Element | null
    if (!target || typeof target.closest !== 'function') return

    const button = target.closest<HTMLButtonElement>('button[data-embed-consent-button]')
    if (!button) return

    const container = button.closest<HTMLElement>('[data-embed-consent][data-embed-payload]')
    if (!container) return

    const payload = parseConsentPayload(container.getAttribute('data-embed-payload') ?? '')
    if (payload === null) return

    container.innerHTML = renderConsentPayload(payload)
    container.removeAttribute('data-embed-payload')
    container.removeAttribute('data-embed-consent')
    activateEmbedMarkup(container, ownerDocument)
  }

  root.addEventListener('click', onClick)
  return () => root.removeEventListener('click', onClick)
}

/**
 * Create the embed plugin
 *
 * @param options - Embed options
 * @returns Markdown plugin
 */
export function embedPlugin(options: EmbedOptions = {}): MarkdownPlugin {
  const {
    youtube = false,
    vimeo = false,
    twitter = false,
    codesandbox = false,
    codepen = false,
    gist = false,
    loom = false,
    autoEmbed = false,
    responsive = true,
    consent = false,
    consentMessage = 'Click to load external content',
  } = options

  /** Optionally wrap rendered embed in a consent placeholder. */
  const maybeConsent = (html: string, payload: ConsentPayload): string =>
    consent ? wrapWithConsent(payload, consentMessage) : html

  const youtubeOpts: YouTubeOptions = typeof youtube === 'object' ? youtube : {}
  const vimeoOpts: VimeoOptions = typeof vimeo === 'object' ? vimeo : {}
  const twitterOpts: TwitterOptions = typeof twitter === 'object' ? twitter : {}

  return (builder) => {
    const deferTrustedMarkup = builder.options.allowHtml === true
      && builder.options.sanitize === true
    const deferredMarkup = new Map<string, string>()
    const markerPrefix = `NEOMARKDOWNEMBED${createMarkerNonce()}`
    let markerCounter = 0
    const emitTrustedMarkup = (html: string): string => {
      if (!deferTrustedMarkup) return html
      const marker = `${markerPrefix}${markerCounter++}END`
      deferredMarkup.set(marker, html)
      return marker
    }

    if (deferTrustedMarkup) {
      builder.addTokenTransform((tokens) => {
        deferredMarkup.clear()
        markerCounter = 0
        return tokens
      })
      builder.addHtmlTransform((html) => {
        let result = html
        for (const [marker, markup] of deferredMarkup) {
          result = result.replace(marker, markup)
        }
        deferredMarkup.clear()
        return result
      })
    }

    // 1. Add block rule for directive syntax (::youtube[id], ::vimeo[id], ::tweet[id])
    builder.addBlockRule({
      name: 'directive',
      priority: 'before:paragraph',
      tokenize(src) {
        const match = DIRECTIVE_PATTERN.exec(src)
        if (!match) return null

        const name = match[1]
        const label = match[2] || undefined
        const attributes = parseAttributes(match[3])

        // Only match known embed directives
        if (
          (name === 'youtube' && youtube) ||
          (name === 'vimeo' && vimeo) ||
          (name === 'tweet' && twitter) ||
          (name === 'codesandbox' && codesandbox) ||
          (name === 'codepen' && codepen) ||
          (name === 'gist' && gist) ||
          (name === 'loom' && loom)
        ) {
          return {
            token: {
              type: 'directive',
              raw: match[0],
              name,
              label,
              attributes,
            },
            raw: match[0],
          }
        }

        return null
      },
    })

    // 2. Render directives as embeds
    builder.setRenderer('directive', (token: DirectiveToken) => {
      const id = token.label ?? ''
      if (!id) return ''

      if (token.name === 'youtube' && youtube) {
        return emitTrustedMarkup(maybeConsent(renderYouTube(id, token.attributes, youtubeOpts, responsive), {
          provider: 'youtube', id, attributes: token.attributes, responsive, youtubeOptions: youtubeOpts,
        }))
      }
      if (token.name === 'vimeo' && vimeo) {
        return emitTrustedMarkup(maybeConsent(renderVimeo(id, token.attributes, vimeoOpts, responsive), {
          provider: 'vimeo', id, attributes: token.attributes, responsive, vimeoOptions: vimeoOpts,
        }))
      }
      if (token.name === 'tweet' && twitter) {
        return emitTrustedMarkup(maybeConsent(renderTweet(id, twitterOpts), {
          provider: 'twitter', id, attributes: token.attributes, responsive, twitterOptions: twitterOpts,
        }))
      }
      if (token.name === 'codesandbox' && codesandbox) {
        return emitTrustedMarkup(maybeConsent(renderCodeSandbox(id, token.attributes, responsive), {
          provider: 'codesandbox', id, attributes: token.attributes, responsive,
        }))
      }
      if (token.name === 'codepen' && codepen) {
        return emitTrustedMarkup(maybeConsent(renderCodePen(id, token.attributes, responsive, token.attributes['user']), {
          provider: 'codepen', id, attributes: token.attributes, responsive,
        }))
      }
      if (token.name === 'gist' && gist) {
        return emitTrustedMarkup(maybeConsent(renderGist(id, token.attributes, token.attributes['user']), {
          provider: 'gist', id, attributes: token.attributes, responsive,
        }))
      }
      if (token.name === 'loom' && loom) {
        return emitTrustedMarkup(maybeConsent(renderLoom(id, token.attributes, responsive), {
          provider: 'loom', id, attributes: token.attributes, responsive,
        }))
      }

      return ''
    })

    // 3. Auto-embed: convert paragraphs with a single bare URL into directives
    if (autoEmbed) {
      builder.addTokenTransform((tokens) =>
        tokens.map((token) => {
          if (token.type !== 'paragraph') return token

          // Check if the paragraph text is a single bare URL (no other text)
          const text = token.text.trim()
          if (/\s/.test(text) || !/^(?:https?:\/\/|www\.)/.test(text)) return token
          const urlMatch = matchEmbedUrl(text)
          if (!urlMatch) return token

          // Check if the provider is enabled
          if (urlMatch.provider === 'youtube' && !youtube) return token
          if (urlMatch.provider === 'vimeo' && !vimeo) return token
          if (urlMatch.provider === 'twitter' && !twitter) return token
          if (urlMatch.provider === 'codesandbox' && !codesandbox) return token
          if (urlMatch.provider === 'codepen' && !codepen) return token
          if (urlMatch.provider === 'gist' && !gist) return token
          if (urlMatch.provider === 'loom' && !loom) return token

          // Map provider to directive name
          const directiveName = urlMatch.provider === 'twitter' ? 'tweet' : urlMatch.provider

          // Convert to directive token
          const directive: DirectiveToken = {
            type: 'directive',
            raw: token.raw,
            name: directiveName,
            label: urlMatch.id,
            attributes: urlMatch.meta ?? {},
          }

          return directive
        })
      )
    }
  }
}
