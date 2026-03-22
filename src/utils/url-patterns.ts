/**
 * URL patterns for auto-embed detection
 *
 * Matches bare URLs in paragraphs that should be converted to embed directives.
 */

export interface UrlMatch {
  provider: 'youtube' | 'vimeo' | 'twitter' | 'codesandbox' | 'codepen' | 'gist' | 'loom'
  id: string
  /** Extra metadata from URL parsing (e.g., CodePen user, Gist user) */
  meta?: Record<string, string>
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

  for (const pattern of CODESANDBOX_PATTERNS) {
    const match = pattern.exec(url)
    if (match?.[1]) return { provider: 'codesandbox', id: match[1] }
  }

  for (const pattern of CODEPEN_PATTERNS) {
    const match = pattern.exec(url)
    if (match?.[1] && match?.[2]) return { provider: 'codepen', id: match[2], meta: { user: match[1] } }
  }

  for (const pattern of GIST_PATTERNS) {
    const match = pattern.exec(url)
    if (match?.[1] && match?.[2]) return { provider: 'gist', id: match[2], meta: { user: match[1] } }
  }

  for (const pattern of LOOM_PATTERNS) {
    const match = pattern.exec(url)
    if (match?.[1]) return { provider: 'loom', id: match[1] }
  }

  return null
}

/**
 * CodeSandbox URL patterns
 * Matches: codesandbox.io/s/ID, codesandbox.io/p/sandbox/ID
 */
const CODESANDBOX_PATTERNS = [
  /(?:https?:\/\/)?(?:www\.)?codesandbox\.io\/s\/([\w-]+)/,
  /(?:https?:\/\/)?(?:www\.)?codesandbox\.io\/p\/sandbox\/([\w-]+)/,
]

/**
 * CodePen URL patterns
 * Matches: codepen.io/USER/pen/ID
 */
const CODEPEN_PATTERNS = [
  /(?:https?:\/\/)?(?:www\.)?codepen\.io\/([\w-]+)\/pen\/([\w-]+)/,
]

/**
 * GitHub Gist URL patterns
 * Matches: gist.github.com/USER/ID
 */
const GIST_PATTERNS = [
  /(?:https?:\/\/)?gist\.github\.com\/([\w-]+)\/([\da-f]+)/,
]

/**
 * Loom URL patterns
 * Matches: loom.com/share/ID, loom.com/embed/ID
 */
const LOOM_PATTERNS = [
  /(?:https?:\/\/)?(?:www\.)?loom\.com\/share\/([\da-f]+)/,
  /(?:https?:\/\/)?(?:www\.)?loom\.com\/embed\/([\da-f]+)/,
]
