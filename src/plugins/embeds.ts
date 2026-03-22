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
import { matchEmbedUrl } from '../utils/url-patterns.js'
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
      `allow="accelerometer; ambient-light-sensor; camera; encrypted-media; geolocation; gyroscope; hid; microphone; midi; payment; usb; vr; xr-spatial-tracking" ` +
      `sandbox="allow-forms allow-modals allow-popups allow-presentation allow-same-origin allow-scripts" ` +
      `style="position:absolute;top:0;left:0;width:100%;height:100%;border:none"></iframe>` +
      `</div>\n`
    )
  }

  const width = attrs['width'] ?? '100%'
  const height = attrs['height'] ?? '500'
  return (
    `<div class="embed embed-codesandbox">` +
    `<iframe src="${src}" title="${escape(title)}" width="${escape(width)}" height="${escape(height)}" loading="lazy" ` +
    `sandbox="allow-forms allow-modals allow-popups allow-presentation allow-same-origin allow-scripts" ` +
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
    `allowfullscreen style="border:none"></iframe>` +
    `</div>\n`
  )
}

/**
 * Render a GitHub Gist embed via script tag
 */
function renderGist(id: string, attrs: Record<string, string>, user?: string): string {
  const gistUser = attrs['user'] ?? user ?? ''
  const file = attrs['file'] ? `?file=${escape(attrs['file'])}` : ''
  const src = `https://gist.github.com/${escape(gistUser)}/${escape(id)}.js${file}`

  return (
    `<div class="embed embed-gist">` +
    `<script src="${src}"></script>` +
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
 * Wrap embed HTML in a GDPR consent placeholder.
 * Shows a button instead of the embed — clicking it replaces the placeholder with the actual content.
 */
function wrapWithConsent(embedHtml: string, providerName: string, message: string): string {
  // Encode the embed HTML as a data attribute (base64 to avoid escaping issues)
  const encoded = typeof Buffer !== 'undefined'
    ? Buffer.from(embedHtml).toString('base64')
    : btoa(embedHtml)

  return (
    `<div class="embed embed-consent embed-consent-${escape(providerName)}" ` +
    `style="position:relative;width:100%;padding-bottom:56.25%;overflow:hidden;border-radius:8px;background:#1a1a1a;display:flex;align-items:center;justify-content:center">` +
    `<button type="button" ` +
    `style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);padding:12px 24px;border-radius:6px;border:1px solid #444;background:#2a2a2a;color:#e0e0e0;cursor:pointer;font-size:14px;z-index:1" ` +
    `aria-label="${escape(message)} (${escape(providerName)})" ` +
    `onclick="var p=this.parentElement;p.innerHTML=atob('${encoded}')">${escape(message)}</button>` +
    `</div>\n`
  )
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

  /** Optionally wrap rendered embed in consent placeholder */
  const maybeConsent = (html: string, provider: string): string =>
    consent ? wrapWithConsent(html, provider, consentMessage) : html

  const youtubeOpts: YouTubeOptions = typeof youtube === 'object' ? youtube : {}
  const vimeoOpts: VimeoOptions = typeof vimeo === 'object' ? vimeo : {}
  const twitterOpts: TwitterOptions = typeof twitter === 'object' ? twitter : {}

  return (builder) => {
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
        return maybeConsent(renderYouTube(id, token.attributes, youtubeOpts, responsive), 'youtube')
      }
      if (token.name === 'vimeo' && vimeo) {
        return maybeConsent(renderVimeo(id, token.attributes, vimeoOpts, responsive), 'vimeo')
      }
      if (token.name === 'tweet' && twitter) {
        return maybeConsent(renderTweet(id, twitterOpts), 'twitter')
      }
      if (token.name === 'codesandbox' && codesandbox) {
        return maybeConsent(renderCodeSandbox(id, token.attributes, responsive), 'codesandbox')
      }
      if (token.name === 'codepen' && codepen) {
        return maybeConsent(renderCodePen(id, token.attributes, responsive, token.attributes['user']), 'codepen')
      }
      if (token.name === 'gist' && gist) {
        return maybeConsent(renderGist(id, token.attributes, token.attributes['user']), 'gist')
      }
      if (token.name === 'loom' && loom) {
        return maybeConsent(renderLoom(id, token.attributes, responsive), 'loom')
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
