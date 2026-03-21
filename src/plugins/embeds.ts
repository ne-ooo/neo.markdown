/**
 * Embed plugin for neo.markdown
 *
 * YouTube, Vimeo, Twitter/X embeds via directive syntax and bare-URL auto-embed.
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
 * ```
 *
 * Auto-embed: A paragraph containing only a YouTube/Vimeo URL becomes an embed.
 */

import type { MarkdownPlugin, DirectiveToken } from '../core/types.js'
import { matchEmbedUrl } from '../utils/url-patterns.js'
import { escape } from '../utils/escape.js'

/**
 * YouTube embed options
 */
export interface YouTubeOptions {
  /** Use privacy-enhanced mode (youtube-nocookie.com) */
  privacyEnhanced?: boolean
  /** Default width (default: "100%") */
  width?: string
  /** Default height (default: "auto") */
  height?: string
}

/**
 * Embed plugin options
 */
export interface EmbedOptions {
  /** Enable YouTube embeds (true or options object) */
  youtube?: boolean | YouTubeOptions
  /** Enable Vimeo embeds */
  vimeo?: boolean
  /** Enable Twitter/X embeds */
  twitter?: boolean
  /** Auto-embed bare URLs in paragraphs (default: false) */
  autoEmbed?: boolean
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
 * Render a YouTube embed iframe
 */
function renderYouTube(id: string, attrs: Record<string, string>, options: YouTubeOptions): string {
  const domain = options.privacyEnhanced
    ? 'www.youtube-nocookie.com'
    : 'www.youtube.com'
  const width = attrs['width'] ?? options.width ?? '100%'
  const height = attrs['height'] ?? options.height ?? '315'
  const title = attrs['title'] ?? 'YouTube video'
  const src = `https://${domain}/embed/${escape(id)}`

  return (
    `<div class="embed embed-youtube">` +
    `<iframe width="${escape(width)}" height="${escape(height)}" ` +
    `src="${src}" title="${escape(title)}" ` +
    `frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" ` +
    `allowfullscreen></iframe>` +
    `</div>\n`
  )
}

/**
 * Render a Vimeo embed iframe
 */
function renderVimeo(id: string, attrs: Record<string, string>): string {
  const width = attrs['width'] ?? '100%'
  const height = attrs['height'] ?? '315'
  const title = attrs['title'] ?? 'Vimeo video'
  const src = `https://player.vimeo.com/video/${escape(id)}`

  return (
    `<div class="embed embed-vimeo">` +
    `<iframe width="${escape(width)}" height="${escape(height)}" ` +
    `src="${src}" title="${escape(title)}" ` +
    `frameborder="0" allow="autoplay; fullscreen; picture-in-picture" ` +
    `allowfullscreen></iframe>` +
    `</div>\n`
  )
}

/**
 * Render a Twitter/X embed blockquote with script
 */
function renderTweet(id: string): string {
  return (
    `<div class="embed embed-twitter">` +
    `<blockquote class="twitter-tweet" data-tweet-id="${escape(id)}">` +
    `<a href="https://twitter.com/i/status/${escape(id)}">Loading tweet...</a>` +
    `</blockquote>` +
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
    autoEmbed = false,
  } = options

  const youtubeOpts: YouTubeOptions = typeof youtube === 'object' ? youtube : {}

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
          (name === 'tweet' && twitter)
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
        return renderYouTube(id, token.attributes, youtubeOpts)
      }
      if (token.name === 'vimeo' && vimeo) {
        return renderVimeo(id, token.attributes)
      }
      if (token.name === 'tweet' && twitter) {
        return renderTweet(id)
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

          // Convert to directive token
          const directive: DirectiveToken = {
            type: 'directive',
            raw: token.raw,
            name: urlMatch.provider === 'twitter' ? 'tweet' : urlMatch.provider,
            label: urlMatch.id,
            attributes: {},
          }

          return directive
        })
      )
    }
  }
}
