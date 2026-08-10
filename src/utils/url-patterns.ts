/** Structural URL matching for bare-URL embeds. */

export interface UrlMatch {
  provider: 'youtube' | 'vimeo' | 'twitter' | 'codesandbox' | 'codepen' | 'gist' | 'loom'
  id: string
  /** Extra metadata from URL parsing, such as a CodePen or Gist user. */
  meta?: Record<string, string>
}

const YOUTUBE_ID_RE = /^[\w-]{11}$/
const SIMPLE_ID_RE = /^[\w-]+$/
const HEX_ID_RE = /^[\da-f]+$/i

function parseHttpUrl(value: string): URL | null {
  if (!value || value !== value.trim() || /\s/.test(value)) return null

  const source = value.startsWith('www.') ? `https://${value}` : value
  if (!/^https?:\/\//i.test(source)) return null

  try {
    const url = new URL(source)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (url.username || url.password) return null
    if (url.port) return null
    return url
  } catch {
    return null
  }
}

function hasHost(url: URL, ...hosts: string[]): boolean {
  return hosts.includes(url.hostname.toLowerCase())
}

function pathSegments(url: URL): string[] {
  return url.pathname.split('/').filter(Boolean)
}

/** Match one complete URL against the supported embed providers. */
export function matchEmbedUrl(value: string): UrlMatch | null {
  const url = parseHttpUrl(value)
  if (!url) return null

  const segments = pathSegments(url)

  if (hasHost(url, 'youtube.com', 'www.youtube.com', 'm.youtube.com')) {
    if (url.pathname === '/watch') {
      const id = url.searchParams.get('v') ?? ''
      if (YOUTUBE_ID_RE.test(id)) return { provider: 'youtube', id }
    }
    if (segments.length === 2 && segments[0] === 'embed' && YOUTUBE_ID_RE.test(segments[1])) {
      return { provider: 'youtube', id: segments[1] }
    }
    return null
  }

  if (hasHost(url, 'youtu.be', 'www.youtu.be')) {
    const id = segments.length === 1 ? segments[0] : ''
    return YOUTUBE_ID_RE.test(id) ? { provider: 'youtube', id } : null
  }

  if (hasHost(url, 'vimeo.com', 'www.vimeo.com')) {
    const id = segments.length === 1 ? segments[0] : ''
    return /^\d+$/.test(id) ? { provider: 'vimeo', id } : null
  }

  if (hasHost(url, 'player.vimeo.com')) {
    const id = segments.length === 2 && segments[0] === 'video' ? segments[1] : ''
    return /^\d+$/.test(id) ? { provider: 'vimeo', id } : null
  }

  if (hasHost(url, 'twitter.com', 'www.twitter.com', 'x.com', 'www.x.com')) {
    const id = segments.length === 3 && segments[1] === 'status' ? segments[2] : ''
    if (/^[\w-]+$/.test(segments[0] ?? '') && /^\d+$/.test(id)) {
      return { provider: 'twitter', id }
    }
    return null
  }

  if (hasHost(url, 'codesandbox.io', 'www.codesandbox.io')) {
    const shortId = segments.length === 2 && segments[0] === 's' ? segments[1] : ''
    const projectId = (
      segments.length === 3 && segments[0] === 'p' && segments[1] === 'sandbox'
    ) ? segments[2] : ''
    const id = shortId || projectId
    return SIMPLE_ID_RE.test(id) ? { provider: 'codesandbox', id } : null
  }

  if (hasHost(url, 'codepen.io', 'www.codepen.io')) {
    const user = segments.length === 3 && segments[1] === 'pen' ? segments[0] : ''
    const id = user ? segments[2] : ''
    if (SIMPLE_ID_RE.test(user) && SIMPLE_ID_RE.test(id)) {
      return { provider: 'codepen', id, meta: { user } }
    }
    return null
  }

  if (hasHost(url, 'gist.github.com')) {
    const user = segments.length === 2 ? segments[0] : ''
    const id = segments.length === 2 ? segments[1] : ''
    if (SIMPLE_ID_RE.test(user) && HEX_ID_RE.test(id)) {
      return { provider: 'gist', id, meta: { user } }
    }
    return null
  }

  if (hasHost(url, 'loom.com', 'www.loom.com')) {
    const id = (
      segments.length === 2 && (segments[0] === 'share' || segments[0] === 'embed')
    ) ? segments[1] : ''
    return HEX_ID_RE.test(id) ? { provider: 'loom', id } : null
  }

  return null
}
