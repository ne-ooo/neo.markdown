/**
 * React embed components for neo.markdown
 *
 * Production-quality components with:
 * - IntersectionObserver lazy loading
 * - Privacy-enhanced modes
 * - Accessible titles
 * - Script deduplication (Tweet)
 * - Dark mode support (Tweet)
 * - Responsive containers
 * - Proper cleanup on unmount
 *
 * @example
 * ```tsx
 * import { YouTube, Vimeo, Tweet } from '@lpm.dev/neo.markdown/plugins/embeds/react'
 *
 * <YouTube id="dQw4w9WgXcQ" />
 * <Vimeo id="53373707" />
 * <Tweet id="1234567890" theme="dark" />
 * ```
 */

import { useState, useEffect, useRef, type FC } from 'react'

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

const RESPONSIVE_CONTAINER: React.CSSProperties = {
  position: 'relative',
  width: '100%',
  paddingBottom: '56.25%',
  overflow: 'hidden',
  borderRadius: '8px',
  background: '#1a1a1a',
}

const RESPONSIVE_IFRAME: React.CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  width: '100%',
  height: '100%',
  border: 'none',
}

/**
 * Hook: observe when element enters viewport
 */
function useInView(
  margin = '200px',
  disabled = false
): [React.RefObject<HTMLDivElement | null>, boolean] {
  const ref = useRef<HTMLDivElement | null>(null)
  const [inView, setInView] = useState(false)

  useEffect(() => {
    if (disabled) return
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') {
      setInView(true) // Fallback: render immediately if no IO
      return
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setInView(true)
          observer.disconnect()
        }
      },
      { rootMargin: margin }
    )

    observer.observe(el)
    return () => observer.disconnect()
  }, [disabled, margin])

  return [ref, inView]
}

// ---------------------------------------------------------------------------
// YouTube
// ---------------------------------------------------------------------------

export interface YouTubeProps {
  /** YouTube video ID */
  id: string
  /** Accessible title (default: "YouTube video") */
  title?: string
  /** Use privacy-enhanced mode (default: true) */
  privacyEnhanced?: boolean
  /** Lazy load the iframe (default: true) */
  lazyLoad?: boolean
  /** Additional className */
  className?: string
}

export const YouTube: FC<YouTubeProps> = ({
  id,
  title = 'YouTube video',
  privacyEnhanced = true,
  lazyLoad = true,
  className,
}) => {
  const domain = privacyEnhanced ? 'www.youtube-nocookie.com' : 'www.youtube.com'
  const src = `https://${domain}/embed/${id}`

  return (
    <div className={`embed embed-youtube${className ? ` ${className}` : ''}`} style={RESPONSIVE_CONTAINER}>
      <iframe
        src={src}
        title={title}
        loading={lazyLoad ? 'lazy' : undefined}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        style={RESPONSIVE_IFRAME}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Vimeo
// ---------------------------------------------------------------------------

export interface VimeoProps {
  /** Vimeo video ID */
  id: string
  /** Accessible title (default: "Vimeo video") */
  title?: string
  /** Enable Do Not Track (default: true) */
  dnt?: boolean
  /** Lazy load via IntersectionObserver (default: true) */
  lazyLoad?: boolean
  /** Additional className */
  className?: string
}

export const Vimeo: FC<VimeoProps> = ({
  id,
  title = 'Vimeo video',
  dnt = true,
  lazyLoad = true,
  className,
}) => {
  const [ref, inView] = useInView('200px', !lazyLoad)
  const dntParam = dnt ? '?dnt=1' : ''
  const src = `https://player.vimeo.com/video/${id}${dntParam}`

  return (
    <div ref={ref} className={`embed embed-vimeo${className ? ` ${className}` : ''}`} style={RESPONSIVE_CONTAINER}>
      {(!lazyLoad || inView) && (
        <iframe
          src={src}
          title={title}
          allow="autoplay; fullscreen; picture-in-picture"
          allowFullScreen
          style={RESPONSIVE_IFRAME}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tweet
// ---------------------------------------------------------------------------

export interface TweetProps {
  /** Tweet ID */
  id: string
  /** Enable Do Not Track (default: true) */
  dnt?: boolean
  /** Theme for the embed */
  theme?: 'light' | 'dark'
  /** Additional className */
  className?: string
}

declare global {
  interface Window {
    twttr?: {
      widgets: {
        load: (el?: HTMLElement) => void
      }
    }
  }
}

export const TWEET_WIDGET_RETRY_INTERVAL_MS = 100
export const TWEET_WIDGET_MAX_RETRIES = 100

export interface TweetWidgetPollOptions {
  intervalMs?: number
  maxAttempts?: number
  /** Internal/readiness hook invoked when all attempts are used. */
  onExhausted?: () => void
}

/** Poll a widget loader with a hard attempt limit and return a cancellation function. */
export function pollTweetWidgets(
  tryLoad: () => boolean,
  options: TweetWidgetPollOptions = {}
): () => void {
  const intervalMs = Number.isFinite(options.intervalMs) && (options.intervalMs ?? -1) >= 0
    ? options.intervalMs ?? TWEET_WIDGET_RETRY_INTERVAL_MS
    : TWEET_WIDGET_RETRY_INTERVAL_MS
  const maxAttempts = Number.isSafeInteger(options.maxAttempts) && (options.maxAttempts ?? 0) > 0
    ? Math.min(options.maxAttempts ?? TWEET_WIDGET_MAX_RETRIES, TWEET_WIDGET_MAX_RETRIES)
    : TWEET_WIDGET_MAX_RETRIES
  let cancelled = false
  let attempts = 0
  let timer: ReturnType<typeof setTimeout> | undefined

  const check = (): void => {
    if (cancelled || attempts >= maxAttempts) return
    attempts++
    if (tryLoad()) return
    if (attempts >= maxAttempts) {
      options.onExhausted?.()
      return
    }
    timer = globalThis.setTimeout(check, intervalMs)
  }

  check()
  return () => {
    cancelled = true
    if (timer !== undefined) globalThis.clearTimeout(timer)
  }
}

const tweetReadySubscribers = new Set<() => void>()
let stopSharedTweetPolling: (() => void) | undefined
let watchedTweetScript: HTMLScriptElement | undefined
let watchedTweetScriptLoad: (() => void) | undefined

function stopTweetReadinessWork(): void {
  stopSharedTweetPolling?.()
  stopSharedTweetPolling = undefined
  if (watchedTweetScript && watchedTweetScriptLoad) {
    watchedTweetScript.removeEventListener('load', watchedTweetScriptLoad)
  }
  watchedTweetScript = undefined
  watchedTweetScriptLoad = undefined
}

function notifyTweetReady(): boolean {
  if (!window.twttr?.widgets) return false
  const subscribers = [...tweetReadySubscribers]
  tweetReadySubscribers.clear()
  stopTweetReadinessWork()
  for (const subscriber of subscribers) subscriber()
  return true
}

function startTweetReadinessPolling(): void {
  if (stopSharedTweetPolling) return
  stopSharedTweetPolling = pollTweetWidgets(notifyTweetReady, {
    onExhausted: () => { stopSharedTweetPolling = undefined },
  })
}

function watchTweetScript(script: HTMLScriptElement): void {
  if (watchedTweetScript === script) return
  if (watchedTweetScript && watchedTweetScriptLoad) {
    watchedTweetScript.removeEventListener('load', watchedTweetScriptLoad)
  }

  watchedTweetScript = script
  watchedTweetScriptLoad = () => {
    if (!notifyTweetReady()) startTweetReadinessPolling()
  }
  script.addEventListener('load', watchedTweetScriptLoad, { once: true })
}

function subscribeTweetReady(subscriber: () => void): () => void {
  tweetReadySubscribers.add(subscriber)
  let script = document.querySelector<HTMLScriptElement>(
    'script[src*="platform.twitter.com/widgets.js"]'
  )
  const existing = Boolean(script)

  if (!script) {
    script = document.createElement('script')
    script.src = 'https://platform.twitter.com/widgets.js'
    script.async = true
    document.head.appendChild(script)
  }
  watchTweetScript(script)

  if (existing) {
    if (!notifyTweetReady()) startTweetReadinessPolling()
  }

  return () => {
    tweetReadySubscribers.delete(subscriber)
    if (tweetReadySubscribers.size === 0) stopTweetReadinessWork()
  }
}

export const Tweet: FC<TweetProps> = ({
  id,
  dnt = true,
  theme,
  className,
}) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const [ref, inView] = useInView()
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!inView || loaded || !containerRef.current) return

    let cancelled = false
    const load = (): void => {
      if (cancelled || !window.twttr?.widgets) return
      window.twttr.widgets.load(containerRef.current ?? undefined)
      setLoaded(true)
    }
    const unsubscribe = subscribeTweetReady(load)

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [inView, loaded])

  return (
    <div
      ref={(el) => {
        (ref as React.MutableRefObject<HTMLDivElement | null>).current = el
        ;(containerRef as React.MutableRefObject<HTMLDivElement | null>).current = el
      }}
      className={`embed embed-twitter${className ? ` ${className}` : ''}`}
      style={{ minHeight: '200px', display: 'flex', justifyContent: 'center' }}
    >
      <blockquote
        className="twitter-tweet"
        data-dnt={dnt ? 'true' : undefined}
        data-theme={theme}
      >
        <a href={`https://twitter.com/i/status/${id}`}>Loading tweet...</a>
      </blockquote>
    </div>
  )
}

// ---------------------------------------------------------------------------
// CodeSandbox
// ---------------------------------------------------------------------------

export interface CodeSandboxProps {
  /** Sandbox ID */
  id: string
  /** Accessible title (default: "CodeSandbox") */
  title?: string
  /** Additional className */
  className?: string
}

export const CodeSandbox: FC<CodeSandboxProps> = ({
  id,
  title = 'CodeSandbox',
  className,
}) => {
  const src = `https://codesandbox.io/embed/${id}?fontsize=14&hidenavigation=1&theme=dark`

  return (
    <div className={`embed embed-codesandbox${className ? ` ${className}` : ''}`} style={RESPONSIVE_CONTAINER}>
      <iframe
        src={src}
        title={title}
        loading="lazy"
        sandbox="allow-same-origin allow-scripts"
        style={RESPONSIVE_IFRAME}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// CodePen
// ---------------------------------------------------------------------------

export interface CodePenProps {
  /** Pen ID */
  id: string
  /** CodePen username */
  user: string
  /** Accessible title (default: "CodePen") */
  title?: string
  /** Default tab (default: "result") */
  defaultTab?: string
  /** Additional className */
  className?: string
}

export const CodePen: FC<CodePenProps> = ({
  id,
  user,
  title = 'CodePen',
  defaultTab = 'result',
  className,
}) => {
  const src = `https://codepen.io/${user}/embed/${id}?default-tab=${defaultTab}`

  return (
    <div className={`embed embed-codepen${className ? ` ${className}` : ''}`} style={RESPONSIVE_CONTAINER}>
      <iframe
        src={src}
        title={title}
        loading="lazy"
        sandbox="allow-same-origin allow-scripts"
        allowFullScreen
        style={RESPONSIVE_IFRAME}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Loom
// ---------------------------------------------------------------------------

export interface LoomProps {
  /** Loom video ID */
  id: string
  /** Accessible title (default: "Loom video") */
  title?: string
  /** Additional className */
  className?: string
}

export const Loom: FC<LoomProps> = ({
  id,
  title = 'Loom video',
  className,
}) => {
  const src = `https://www.loom.com/embed/${id}`

  return (
    <div className={`embed embed-loom${className ? ` ${className}` : ''}`} style={RESPONSIVE_CONTAINER}>
      <iframe
        src={src}
        title={title}
        loading="lazy"
        allowFullScreen
        style={RESPONSIVE_IFRAME}
      />
    </div>
  )
}
