/**
 * URL patterns for auto-embed detection
 *
 * Matches bare URLs in paragraphs that should be converted to embed directives.
 */

export interface UrlMatch {
  provider: 'youtube' | 'vimeo' | 'twitter'
  id: string
}

/**
 * YouTube URL patterns
 * Matches: youtube.com/watch?v=ID, youtu.be/ID, youtube.com/embed/ID
 */
const YOUTUBE_PATTERNS = [
  /(?:https?:\/\/)?(?:www\.)?youtube\.com\/watch\?v=([\w-]{11})/,
  /(?:https?:\/\/)?youtu\.be\/([\w-]{11})/,
  /(?:https?:\/\/)?(?:www\.)?youtube\.com\/embed\/([\w-]{11})/,
]

/**
 * Vimeo URL patterns
 * Matches: vimeo.com/ID, player.vimeo.com/video/ID
 */
const VIMEO_PATTERNS = [
  /(?:https?:\/\/)?(?:www\.)?vimeo\.com\/(\d+)/,
  /(?:https?:\/\/)?player\.vimeo\.com\/video\/(\d+)/,
]

/**
 * Twitter/X URL patterns
 * Matches: twitter.com/user/status/ID, x.com/user/status/ID
 */
const TWITTER_PATTERNS = [
  /(?:https?:\/\/)?(?:www\.)?twitter\.com\/\w+\/status\/(\d+)/,
  /(?:https?:\/\/)?(?:www\.)?x\.com\/\w+\/status\/(\d+)/,
]

/**
 * Try to match a URL against known embed providers
 *
 * @param url - URL string to test
 * @returns Match result with provider and ID, or null
 */
export function matchEmbedUrl(url: string): UrlMatch | null {
  for (const pattern of YOUTUBE_PATTERNS) {
    const match = pattern.exec(url)
    if (match?.[1]) return { provider: 'youtube', id: match[1] }
  }

  for (const pattern of VIMEO_PATTERNS) {
    const match = pattern.exec(url)
    if (match?.[1]) return { provider: 'vimeo', id: match[1] }
  }

  for (const pattern of TWITTER_PATTERNS) {
    const match = pattern.exec(url)
    if (match?.[1]) return { provider: 'twitter', id: match[1] }
  }

  return null
}
