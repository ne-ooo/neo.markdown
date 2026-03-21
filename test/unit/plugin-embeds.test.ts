/**
 * Embed plugin tests
 *
 * Tests directive parsing, each embed type, auto-embed, and XSS prevention.
 */

import { describe, it, expect } from 'vitest'
import { parse } from '../../src/index.js'
import { embedPlugin } from '../../src/plugins/embeds.js'
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
    expect(result).toContain('youtube.com/embed/dQw4w9WgXcQ')
    expect(result).toContain('<iframe')
    expect(result).toContain('allowfullscreen')
  })

  it('should render Vimeo directive', () => {
    const result = parse('::vimeo[53373707]', { plugins: [plugin] })
    expect(result).toContain('embed-vimeo')
    expect(result).toContain('player.vimeo.com/video/53373707')
    expect(result).toContain('<iframe')
  })

  it('should render Twitter/tweet directive', () => {
    const result = parse('::tweet[1234567890]', { plugins: [plugin] })
    expect(result).toContain('embed-twitter')
    expect(result).toContain('twitter-tweet')
    expect(result).toContain('data-tweet-id="1234567890"')
  })

  it('should pass directive attributes to embed', () => {
    const result = parse('::youtube[dQw4w9WgXcQ]{title="My Video" width="640"}', {
      plugins: [plugin],
    })
    expect(result).toContain('title="My Video"')
    expect(result).toContain('width="640"')
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
    expect(result).toContain('youtube.com/embed/dQw4w9WgXcQ')
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
