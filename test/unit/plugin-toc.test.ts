/**
 * TOC plugin tests
 *
 * Tests slugification, duplicate headings, anchor HTML, maxDepth, and onToc callback.
 */

import { describe, it, expect } from 'vitest'
import { parse } from '../../src/index.js'
import { tocPlugin } from '../../src/plugins/toc.js'
import type { TocEntry } from '../../src/plugins/toc.js'
import { slugify, createSlugger } from '../../src/utils/slug.js'

// ---------------------------------------------------------------------------
// Slugify Utility
// ---------------------------------------------------------------------------

describe('slugify', () => {
  it('should convert to lowercase', () => {
    expect(slugify('Hello World')).toBe('hello-world')
  })

  it('should replace spaces with hyphens', () => {
    expect(slugify('hello world test')).toBe('hello-world-test')
  })

  it('should remove special characters', () => {
    expect(slugify('Hello, World! (test)')).toBe('hello-world-test')
  })

  it('should collapse multiple hyphens', () => {
    expect(slugify('hello---world')).toBe('hello-world')
  })

  it('should trim leading/trailing hyphens', () => {
    expect(slugify('  hello  ')).toBe('hello')
  })

  it('should remove HTML tags', () => {
    expect(slugify('Hello <strong>World</strong>')).toBe('hello-world')
  })

  it('should remove HTML entities', () => {
    expect(slugify('Hello &amp; World')).toBe('hello-world')
  })

  it('should handle empty string', () => {
    expect(slugify('')).toBe('')
  })
})

describe('createSlugger', () => {
  it('should handle unique headings', () => {
    const slugger = createSlugger()
    expect(slugger.slug('Hello')).toBe('hello')
    expect(slugger.slug('World')).toBe('world')
  })

  it('should append counter for duplicate headings', () => {
    const slugger = createSlugger()
    expect(slugger.slug('Hello')).toBe('hello')
    expect(slugger.slug('Hello')).toBe('hello-1')
    expect(slugger.slug('Hello')).toBe('hello-2')
  })

  it('should track different headings separately', () => {
    const slugger = createSlugger()
    expect(slugger.slug('Hello')).toBe('hello')
    expect(slugger.slug('World')).toBe('world')
    expect(slugger.slug('Hello')).toBe('hello-1')
    expect(slugger.slug('World')).toBe('world-1')
  })

  it('should fallback to "heading" for empty text', () => {
    const slugger = createSlugger()
    expect(slugger.slug('')).toBe('heading')
    expect(slugger.slug('')).toBe('heading-1')
  })
})

// ---------------------------------------------------------------------------
// TOC Plugin - Heading Rendering
// ---------------------------------------------------------------------------

describe('tocPlugin - Heading Rendering', () => {
  it('should add id to headings', () => {
    const plugin = tocPlugin({ anchorLinks: false })
    const result = parse('# Hello World', { plugins: [plugin] })
    expect(result).toBe('<h1 id="hello-world">Hello World</h1>\n')
  })

  it('should add anchor links by default', () => {
    const plugin = tocPlugin()
    const result = parse('# Hello', { plugins: [plugin] })
    expect(result).toContain('<h1 id="hello">')
    expect(result).toContain('<a class="anchor" href="#hello">')
    expect(result).toContain('Hello')
    expect(result).toContain('</a>')
  })

  it('should use custom anchor class', () => {
    const plugin = tocPlugin({ anchorClass: 'heading-link' })
    const result = parse('# Test', { plugins: [plugin] })
    expect(result).toContain('class="heading-link"')
  })

  it('should handle duplicate headings', () => {
    const plugin = tocPlugin({ anchorLinks: false })
    const md = '# Hello\n\n# Hello\n\n# Hello'
    const result = parse(md, { plugins: [plugin] })
    expect(result).toContain('id="hello"')
    expect(result).toContain('id="hello-1"')
    expect(result).toContain('id="hello-2"')
  })

  it('should handle headings with inline formatting', () => {
    const plugin = tocPlugin({ anchorLinks: false })
    const result = parse('## Hello **World**', { plugins: [plugin] })
    expect(result).toContain('id="hello-world"')
    expect(result).toContain('<strong>World</strong>')
  })

  it('should not modify non-heading tokens', () => {
    const plugin = tocPlugin()
    const result = parse('# Heading\n\nParagraph text', { plugins: [plugin] })
    expect(result).toContain('<p>Paragraph text</p>')
  })
})

// ---------------------------------------------------------------------------
// TOC Plugin - maxDepth / minDepth
// ---------------------------------------------------------------------------

describe('tocPlugin - Depth Filtering', () => {
  it('should respect maxDepth', () => {
    const plugin = tocPlugin({ maxDepth: 2, anchorLinks: false })
    const md = '# H1\n\n## H2\n\n### H3'
    const result = parse(md, { plugins: [plugin] })
    expect(result).toContain('<h1 id="h1">')
    expect(result).toContain('<h2 id="h2">')
    // H3 should NOT have an id (beyond maxDepth)
    expect(result).toContain('<h3>H3</h3>')
    expect(result).not.toContain('id="h3"')
  })

  it('should respect minDepth', () => {
    const plugin = tocPlugin({ minDepth: 2, anchorLinks: false })
    const md = '# H1\n\n## H2\n\n### H3'
    const result = parse(md, { plugins: [plugin] })
    // H1 should NOT have an id (below minDepth)
    expect(result).toContain('<h1>H1</h1>')
    expect(result).toContain('<h2 id="h2">')
    expect(result).toContain('<h3 id="h3">')
  })
})

// ---------------------------------------------------------------------------
// TOC Plugin - onToc Callback
// ---------------------------------------------------------------------------

describe('tocPlugin - onToc Callback', () => {
  it('should call onToc with extracted headings', () => {
    let tocEntries: TocEntry[] = []
    const plugin = tocPlugin({
      onToc: (entries) => { tocEntries = entries },
    })

    parse('# Title\n\n## Section 1\n\n### Subsection\n\n## Section 2', {
      plugins: [plugin],
    })

    expect(tocEntries).toHaveLength(4)
    expect(tocEntries[0]).toEqual({ level: 1, text: 'Title', id: 'title' })
    expect(tocEntries[1]).toEqual({ level: 2, text: 'Section 1', id: 'section-1' })
    expect(tocEntries[2]).toEqual({ level: 3, text: 'Subsection', id: 'subsection' })
    expect(tocEntries[3]).toEqual({ level: 2, text: 'Section 2', id: 'section-2' })
  })

  it('should filter by maxDepth in onToc', () => {
    let tocEntries: TocEntry[] = []
    const plugin = tocPlugin({
      maxDepth: 2,
      onToc: (entries) => { tocEntries = entries },
    })

    parse('# H1\n\n## H2\n\n### H3', { plugins: [plugin] })
    expect(tocEntries).toHaveLength(2)
    expect(tocEntries.map((e) => e.level)).toEqual([1, 2])
  })

  it('should not call onToc when there are no headings', () => {
    let called = false
    const plugin = tocPlugin({
      onToc: () => { called = true },
    })

    parse('Just a paragraph', { plugins: [plugin] })
    expect(called).toBe(false)
  })

  it('should handle duplicate headings in onToc', () => {
    let tocEntries: TocEntry[] = []
    const plugin = tocPlugin({
      onToc: (entries) => { tocEntries = entries },
    })

    parse('# Hello\n\n# Hello', { plugins: [plugin] })
    expect(tocEntries).toHaveLength(2)
    expect(tocEntries[0].id).toBe('hello')
    expect(tocEntries[1].id).toBe('hello-1')
  })
})
