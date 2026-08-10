/**
 * Embed plugin tests
 *
 * Tests directive parsing, each embed type, auto-embed, and XSS prevention.
 */

import { describe, it, expect, vi } from 'vitest'
import { parse } from '../../src/index.js'
import { embedPlugin, initializeEmbeds } from '../../src/plugins/embeds.js'
import { matchEmbedUrl } from '../../src/utils/url-patterns.js'

// ---------------------------------------------------------------------------
// URL Pattern Matching
// ---------------------------------------------------------------------------

describe('matchEmbedUrl', () => {
  it('should match youtube.com/watch URLs', () => {
    const result = matchEmbedUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
    expect(result).toEqual({ provider: 'youtube', id: 'dQw4w9WgXcQ' })
  })

  it('should match youtu.be URLs', () => {
    const result = matchEmbedUrl('https://youtu.be/dQw4w9WgXcQ')
    expect(result).toEqual({ provider: 'youtube', id: 'dQw4w9WgXcQ' })
  })

  it('should match youtube embed URLs', () => {
    const result = matchEmbedUrl('https://www.youtube.com/embed/dQw4w9WgXcQ')
    expect(result).toEqual({ provider: 'youtube', id: 'dQw4w9WgXcQ' })
  })

  it('should match vimeo.com URLs', () => {
    const result = matchEmbedUrl('https://vimeo.com/53373707')
    expect(result).toEqual({ provider: 'vimeo', id: '53373707' })
  })

  it('should match player.vimeo.com URLs', () => {
    const result = matchEmbedUrl('https://player.vimeo.com/video/53373707')
    expect(result).toEqual({ provider: 'vimeo', id: '53373707' })
  })

  it('should match twitter.com status URLs', () => {
    const result = matchEmbedUrl('https://twitter.com/user/status/1234567890')
    expect(result).toEqual({ provider: 'twitter', id: '1234567890' })
  })

  it('should match x.com status URLs', () => {
    const result = matchEmbedUrl('https://x.com/user/status/1234567890')
    expect(result).toEqual({ provider: 'twitter', id: '1234567890' })
  })

  it('should return null for unknown URLs', () => {
    expect(matchEmbedUrl('https://example.com')).toBeNull()
  })

  it('should return null for non-URL text', () => {
    expect(matchEmbedUrl('just some text')).toBeNull()
  })

  it('should reject provider URLs embedded in attacker-controlled URLs', () => {
    const youtube = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'

    expect(matchEmbedUrl(`https://evil.example/?next=${youtube}`)).toBeNull()
    expect(matchEmbedUrl(`https://evil.example/${youtube}`)).toBeNull()
    expect(matchEmbedUrl('https://www.youtube.com.evil.example/watch?v=dQw4w9WgXcQ')).toBeNull()
    expect(matchEmbedUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ/extra')).toBeNull()
    expect(matchEmbedUrl('https://www.youtube.com:8443/watch?v=dQw4w9WgXcQ')).toBeNull()
  })

  it('should match URLs without protocol', () => {
    const result = matchEmbedUrl('www.youtube.com/watch?v=dQw4w9WgXcQ')
    expect(result).toEqual({ provider: 'youtube', id: 'dQw4w9WgXcQ' })
  })
})

// ---------------------------------------------------------------------------
// Directive Syntax
// ---------------------------------------------------------------------------

describe('embedPlugin - Directive Syntax', () => {
  const plugin = embedPlugin({
    youtube: true,
    vimeo: true,
    twitter: true,
  })

  it('should render YouTube directive', () => {
    const result = parse('::youtube[dQw4w9WgXcQ]', { plugins: [plugin] })
    expect(result).toContain('embed-youtube')
    expect(result).toContain('youtube-nocookie.com/embed/dQw4w9WgXcQ')
    expect(result).toContain('<iframe')
    expect(result).toContain('allowfullscreen')
    expect(result).toContain('loading="lazy"')
  })

  it('should render Vimeo directive', () => {
    const result = parse('::vimeo[53373707]', { plugins: [plugin] })
    expect(result).toContain('embed-vimeo')
    expect(result).toContain('player.vimeo.com/video/53373707')
    expect(result).toContain('?dnt=1')
    expect(result).toContain('<iframe')
  })

  it('should render Twitter/tweet directive', () => {
    const result = parse('::tweet[1234567890]', { plugins: [plugin] })
    expect(result).toContain('embed-twitter')
    expect(result).toContain('twitter-tweet')
    expect(result).toContain('data-dnt="true"')
    expect(result).toContain('twitter.com/i/status/1234567890')
  })

  it('should pass directive attributes to embed', () => {
    // With responsive: true (default), width/height from attrs are ignored in favor of CSS
    const result = parse('::youtube[dQw4w9WgXcQ]{title="My Video" width="640"}', {
      plugins: [plugin],
    })
    expect(result).toContain('title="My Video"')
    // Responsive mode uses CSS, not width/height attributes
    expect(result).toContain('padding-bottom:56.25%')
  })

  it('should use privacy-enhanced mode for YouTube', () => {
    const privacyPlugin = embedPlugin({
      youtube: { privacyEnhanced: true },
    })

    const result = parse('::youtube[dQw4w9WgXcQ]', { plugins: [privacyPlugin] })
    expect(result).toContain('youtube-nocookie.com')
    expect(result).not.toContain('www.youtube.com/embed')
  })

  it('should ignore unknown directive names', () => {
    const result = parse('::unknown[test]', { plugins: [plugin] })
    // Should fall through to paragraph
    expect(result).toContain('<p>')
    expect(result).not.toContain('<iframe')
  })

  it('should ignore disabled providers', () => {
    const youtubeOnly = embedPlugin({ youtube: true })
    const result = parse('::vimeo[53373707]', { plugins: [youtubeOnly] })
    expect(result).not.toContain('<iframe')
  })

  it('should render empty string for directive with no label', () => {
    const result = parse('::youtube[]', { plugins: [plugin] })
    expect(result).not.toContain('<iframe')
  })
})

// ---------------------------------------------------------------------------
// Auto-Embed
// ---------------------------------------------------------------------------

describe('embedPlugin - Auto-Embed', () => {
  const plugin = embedPlugin({
    youtube: true,
    vimeo: true,
    twitter: true,
    autoEmbed: true,
  })

  it('should auto-embed YouTube URLs', () => {
    const result = parse('https://www.youtube.com/watch?v=dQw4w9WgXcQ', {
      plugins: [plugin],
    })
    expect(result).toContain('embed-youtube')
    expect(result).toContain('youtube-nocookie.com/embed/dQw4w9WgXcQ')
  })

  it('should auto-embed youtu.be short URLs', () => {
    const result = parse('https://youtu.be/dQw4w9WgXcQ', { plugins: [plugin] })
    expect(result).toContain('embed-youtube')
  })

  it('should auto-embed Vimeo URLs', () => {
    const result = parse('https://vimeo.com/53373707', { plugins: [plugin] })
    expect(result).toContain('embed-vimeo')
  })

  it('should auto-embed Twitter URLs', () => {
    const result = parse('https://twitter.com/user/status/1234567890', {
      plugins: [plugin],
    })
    expect(result).toContain('embed-twitter')
  })

  it('should auto-embed x.com URLs', () => {
    const result = parse('https://x.com/user/status/1234567890', {
      plugins: [plugin],
    })
    expect(result).toContain('embed-twitter')
  })

  it('should not auto-embed when URL is part of text', () => {
    const result = parse('Check out https://www.youtube.com/watch?v=dQw4w9WgXcQ please', {
      plugins: [plugin],
    })
    // URL is not alone in paragraph — should stay as text
    expect(result).toContain('<p>')
    expect(result).not.toContain('<iframe')
  })

  it('should not auto-embed when autoEmbed is false', () => {
    const noAutoPlugin = embedPlugin({
      youtube: true,
      autoEmbed: false,
    })

    const result = parse('https://www.youtube.com/watch?v=dQw4w9WgXcQ', {
      plugins: [noAutoPlugin],
    })
    expect(result).not.toContain('<iframe')
  })

  it('should not auto-embed disabled providers', () => {
    const youtubeOnly = embedPlugin({
      youtube: true,
      autoEmbed: true,
    })

    const result = parse('https://vimeo.com/53373707', { plugins: [youtubeOnly] })
    expect(result).not.toContain('<iframe')
    expect(result).toContain('<p>')
  })
})

// ---------------------------------------------------------------------------
// XSS Prevention
// ---------------------------------------------------------------------------

describe('embedPlugin - XSS Prevention', () => {
  const plugin = embedPlugin({
    youtube: true,
    vimeo: true,
    twitter: true,
  })

  it('should escape directive label in YouTube embed', () => {
    const result = parse('::youtube["><script>alert(1)</script>]', {
      plugins: [plugin],
    })
    expect(result).not.toContain('<script>')
    expect(result).toContain('&quot;')
  })

  it('should escape directive attributes', () => {
    const result = parse('::youtube[test]{title="<script>alert(1)</script>"}', {
      plugins: [plugin],
    })
    expect(result).not.toContain('<script>alert')
  })

  it('should escape tweet ID', () => {
    const result = parse('::tweet["><img onerror=alert(1) src=x>]', {
      plugins: [plugin],
    })
    // The < and > are escaped, so the img tag is not executable
    expect(result).not.toContain('<img onerror')
    expect(result).toContain('&quot;')
    expect(result).toContain('&lt;img')
  })
})

// ---------------------------------------------------------------------------
// New Embed Providers: CodeSandbox, CodePen, GitHub Gist, Loom
// ---------------------------------------------------------------------------

describe('matchEmbedUrl - new providers', () => {
  it('should match CodeSandbox URLs', () => {
    const result = matchEmbedUrl('https://codesandbox.io/s/my-sandbox-123')
    expect(result).toEqual({ provider: 'codesandbox', id: 'my-sandbox-123' })
  })

  it('should match CodeSandbox /p/sandbox/ URLs', () => {
    const result = matchEmbedUrl('https://codesandbox.io/p/sandbox/my-project')
    expect(result).toEqual({ provider: 'codesandbox', id: 'my-project' })
  })

  it('should match CodePen URLs', () => {
    const result = matchEmbedUrl('https://codepen.io/tolgaergin/pen/abc123')
    expect(result).toEqual({ provider: 'codepen', id: 'abc123', meta: { user: 'tolgaergin' } })
  })

  it('should match GitHub Gist URLs', () => {
    const result = matchEmbedUrl('https://gist.github.com/tolgaergin/abc123def456')
    expect(result).toEqual({ provider: 'gist', id: 'abc123def456', meta: { user: 'tolgaergin' } })
  })

  it('should match Loom share URLs', () => {
    const result = matchEmbedUrl('https://www.loom.com/share/abc123def456')
    expect(result).toEqual({ provider: 'loom', id: 'abc123def456' })
  })

  it('should match Loom embed URLs', () => {
    const result = matchEmbedUrl('https://www.loom.com/embed/abc123def456')
    expect(result).toEqual({ provider: 'loom', id: 'abc123def456' })
  })
})

describe('embedPlugin - New Providers Directives', () => {
  const plugin = embedPlugin({
    codesandbox: true,
    codepen: true,
    gist: true,
    loom: true,
  })

  it('should render CodeSandbox directive', () => {
    const result = parse('::codesandbox[my-sandbox]', { plugins: [plugin] })
    expect(result).toContain('embed-codesandbox')
    expect(result).toContain('codesandbox.io/embed/my-sandbox')
    expect(result).toContain('<iframe')
    expect(result).toContain('loading="lazy"')
  })

  it('should render CodePen directive with user attribute', () => {
    const result = parse('::codepen[abc123]{user="myuser"}', { plugins: [plugin] })
    expect(result).toContain('embed-codepen')
    expect(result).toContain('codepen.io/myuser/embed/abc123')
    expect(result).toContain('<iframe')
  })

  it('should render GitHub Gist directive', () => {
    const result = parse('::gist[abc123def]{user="tolgaergin"}', { plugins: [plugin] })
    expect(result).toContain('embed-gist')
    expect(result).toContain('gist.github.com/tolgaergin/abc123def.js')
    expect(result).toContain('data-embed-gist')
    expect(result).not.toContain('<script')
    expect(result).toContain('<noscript>')
  })

  it('should render Gist with file attribute', () => {
    const result = parse('::gist[abc123]{user="user" file="index.ts"}', { plugins: [plugin] })
    expect(result).toContain('file=index.ts')
  })

  it('should render Loom directive', () => {
    const result = parse('::loom[abc123def]', { plugins: [plugin] })
    expect(result).toContain('embed-loom')
    expect(result).toContain('loom.com/embed/abc123def')
    expect(result).toContain('<iframe')
    expect(result).toContain('loading="lazy"')
  })

  it('should not render disabled providers', () => {
    const limitedPlugin = embedPlugin({ codesandbox: true })
    const result = parse('::codepen[abc123]', { plugins: [limitedPlugin] })
    expect(result).not.toContain('embed-codepen')
  })
})

describe('embedPlugin - New Providers Auto-Embed', () => {
  const plugin = embedPlugin({
    codesandbox: true,
    codepen: true,
    gist: true,
    loom: true,
    autoEmbed: true,
  })

  it('should auto-embed CodeSandbox URLs', () => {
    const result = parse('https://codesandbox.io/s/my-sandbox', { plugins: [plugin] })
    expect(result).toContain('embed-codesandbox')
  })

  it('should auto-embed CodePen URLs', () => {
    const result = parse('https://codepen.io/user/pen/abc123', { plugins: [plugin] })
    expect(result).toContain('embed-codepen')
  })

  it('should auto-embed GitHub Gist URLs', () => {
    const result = parse('https://gist.github.com/user/abc123def456', { plugins: [plugin] })
    expect(result).toContain('embed-gist')
  })

  it('should auto-embed Loom URLs', () => {
    const result = parse('https://www.loom.com/share/abc123def456', { plugins: [plugin] })
    expect(result).toContain('embed-loom')
  })
})

// ---------------------------------------------------------------------------
// GDPR Consent Mode
// ---------------------------------------------------------------------------

describe('embedPlugin - GDPR Consent Mode', () => {
  it('should render consent placeholder instead of iframe when consent: true', () => {
    const plugin = embedPlugin({ youtube: true, consent: true })
    const result = parse('::youtube[dQw4w9WgXcQ]', { plugins: [plugin] })
    expect(result).toContain('embed-consent')
    expect(result).toContain('<button')
    expect(result).toContain('Click to load external content')
    expect(result).not.toContain('<iframe')
  })

  it('should use custom consent message', () => {
    const plugin = embedPlugin({
      youtube: true,
      consent: true,
      consentMessage: 'Load YouTube video',
    })
    const result = parse('::youtube[dQw4w9WgXcQ]', { plugins: [plugin] })
    expect(result).toContain('Load YouTube video')
  })

  it('should include provider name in consent CSS class', () => {
    const plugin = embedPlugin({ vimeo: true, consent: true })
    const result = parse('::vimeo[12345]', { plugins: [plugin] })
    expect(result).toContain('embed-consent-vimeo')
  })

  it('should have accessible button with aria-label', () => {
    const plugin = embedPlugin({ youtube: true, consent: true })
    const result = parse('::youtube[dQw4w9WgXcQ]', { plugins: [plugin] })
    expect(result).toContain('aria-label=')
  })

  it('should include inert encoded HTML for the client initializer', () => {
    const plugin = embedPlugin({ youtube: true, consent: true })
    const result = parse('::youtube[dQw4w9WgXcQ]', { plugins: [plugin] })
    expect(result).toContain('data-embed-consent-button')
    expect(result).toContain('data-embed-payload=')
    expect(result).not.toContain('onclick=')
  })

  it('should encode Unicode embed HTML without Node Buffer', () => {
    vi.stubGlobal('Buffer', undefined)
    try {
      const plugin = embedPlugin({ youtube: true, consent: true })
      const render = () => parse('::youtube[id]{title="你好 👋"}', { plugins: [plugin] })
      expect(render).not.toThrow()
      expect(render()).toContain('data-embed-payload=')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('should export an SSR-safe client initializer', () => {
    const cleanup = initializeEmbeds()
    expect(cleanup).toBeTypeOf('function')
    expect(() => cleanup()).not.toThrow()
  })

  it('should reveal consent content through the client initializer', () => {
    const html = parse('::youtube[dQw4w9WgXcQ]', {
      plugins: [embedPlugin({ youtube: true, consent: true })],
    })
    const encoded = /data-embed-payload="([^"]+)"/.exec(html)?.[1]
    expect(encoded).toBeTruthy()

    let clickHandler: ((event: Event) => void) | undefined
    let revealed = ''
    const container = {
      getAttribute: (name: string) => name === 'data-embed-payload' ? encoded ?? '' : null,
      removeAttribute: vi.fn(),
      querySelectorAll: () => [],
      querySelector: () => null,
      set innerHTML(value: string) { revealed = value },
      get innerHTML() { return revealed },
    }
    const button = {
      closest: (selector: string) => selector.startsWith('[data-embed-consent]')
        ? container
        : null,
    }
    const target = {
      closest: (selector: string) => selector.startsWith('button') ? button : null,
    }
    const ownerDocument = {
      createElement: vi.fn(),
      querySelector: () => null,
      head: { appendChild: vi.fn() },
    }
    const root = {
      ownerDocument,
      querySelectorAll: () => [],
      querySelector: () => null,
      addEventListener: (_name: string, handler: (event: Event) => void) => {
        clickHandler = handler
      },
      removeEventListener: vi.fn(),
    }

    vi.stubGlobal('document', ownerDocument)
    try {
      const cleanup = initializeEmbeds({ root: root as unknown as HTMLElement })
      clickHandler?.({ target } as unknown as Event)
      expect(revealed).toContain('<iframe')
      expect(revealed).toContain('youtube-nocookie.com')
      cleanup()
      expect(root.removeEventListener).toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('should activate Gist and Twitter markup only once', () => {
    const createdElements: Array<Record<string, unknown>> = []
    const gistAttributes = new Map<string, string>([
      ['data-gist-src', 'https://gist.github.com/user/abc123.js'],
      ['data-gist-height', '600'],
    ])
    const gist = {
      getAttribute: (name: string) => gistAttributes.get(name) ?? null,
      setAttribute: vi.fn((name: string, value: string) => gistAttributes.set(name, value)),
      appendChild: vi.fn(),
    }
    let twitterScript: Record<string, unknown> | null = null
    const ownerDocument = {
      createElement: (tag: string) => {
        const attributes = new Map<string, string>()
        const element = {
          tag,
          setAttribute: vi.fn((name: string, value: string) => attributes.set(name, value)),
          hasAttribute: (name: string) => attributes.has(name),
          addEventListener: vi.fn(),
        }
        createdElements.push(element)
        return element
      },
      querySelector: (selector: string) => selector.startsWith('script') ? twitterScript : null,
      head: {
        appendChild: vi.fn((script: Record<string, unknown>) => {
          twitterScript = script
        }),
      },
    }
    const root = {
      ownerDocument,
      querySelectorAll: () => [gist],
      querySelector: (selector: string) => selector === '.twitter-tweet' ? {} : null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }

    vi.stubGlobal('document', ownerDocument)
    try {
      initializeEmbeds({ root: root as unknown as HTMLElement })
      initializeEmbeds({ root: root as unknown as HTMLElement })
      expect(gist.appendChild).toHaveBeenCalledTimes(1)
      expect(ownerDocument.head.appendChild).toHaveBeenCalledTimes(1)
      expect(createdElements).toHaveLength(2)
      expect(createdElements[0]?.['tag']).toBe('iframe')
      expect(createdElements[0]?.['srcdoc']).toContain(
        '<script src="https://gist.github.com/user/abc123.js"></script>'
      )
      expect(createdElements[0]?.['setAttribute']).toHaveBeenCalledWith('sandbox', 'allow-scripts')
      expect(createdElements[0]?.['setAttribute']).toHaveBeenCalledWith('height', '600')
      expect(createdElements[1]?.['src']).toBe('https://platform.twitter.com/widgets.js')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('should reject forged consent HTML', () => {
    let clickHandler: ((event: Event) => void) | undefined
    const container = {
      getAttribute: () => btoa('<img src=x onerror=alert(1)>'),
      removeAttribute: vi.fn(),
      querySelectorAll: () => [],
      querySelector: () => null,
      innerHTML: '',
    }
    const button = { closest: () => container }
    const target = { closest: () => button }
    const ownerDocument = {
      createElement: vi.fn(),
      querySelector: () => null,
      head: { appendChild: vi.fn() },
    }
    const root = {
      ownerDocument,
      querySelectorAll: () => [],
      querySelector: () => null,
      addEventListener: (_name: string, handler: (event: Event) => void) => {
        clickHandler = handler
      },
      removeEventListener: vi.fn(),
    }

    vi.stubGlobal('document', ownerDocument)
    try {
      initializeEmbeds({ root: root as unknown as HTMLElement })
      clickHandler?.({ target } as unknown as Event)
      expect(container.innerHTML).toBe('')
      expect(container.removeAttribute).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('should not show consent when consent: false (default)', () => {
    const plugin = embedPlugin({ youtube: true })
    const result = parse('::youtube[dQw4w9WgXcQ]', { plugins: [plugin] })
    expect(result).not.toContain('embed-consent')
    expect(result).toContain('<iframe')
  })

  it('should work with all providers', () => {
    const plugin = embedPlugin({
      youtube: true,
      vimeo: true,
      codesandbox: true,
      loom: true,
      consent: true,
    })

    for (const [directive, provider] of [
      ['::youtube[abc]', 'youtube'],
      ['::vimeo[123]', 'vimeo'],
      ['::codesandbox[test]', 'codesandbox'],
      ['::loom[abc123]', 'loom'],
    ]) {
      const result = parse(directive, { plugins: [plugin] })
      expect(result).toContain(`embed-consent-${provider}`)
      expect(result).toContain('<button')
    }
  })
})
