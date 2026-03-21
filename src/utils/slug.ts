/**
 * Slugify utility for heading anchors
 *
 * Converts heading text to URL-safe slug identifiers.
 * Handles duplicate headings by appending a counter suffix.
 */

/**
 * Convert a string to a URL-safe slug
 *
 * @param text - Raw heading text (may contain HTML entities)
 * @returns Slugified string
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/&[#\w]+;/g, '') // Remove HTML entities
    .replace(/<[^>]*>/g, '')  // Remove HTML tags
    .trim()
    .replace(/[^\w\s-]/g, '') // Remove non-word chars (except spaces and hyphens)
    .replace(/\s+/g, '-')     // Spaces → hyphens
    .replace(/-+/g, '-')      // Collapse multiple hyphens
    .replace(/^-|-$/g, '')    // Trim leading/trailing hyphens
}

/**
 * Creates a slug tracker that handles duplicate headings
 * by appending -1, -2, etc. for repeated slugs.
 *
 * @returns Object with a `slug(text)` method
 */
export function createSlugger(): { slug: (text: string) => string } {
  const seen = new Map<string, number>()

  return {
    slug(text: string): string {
      let slug = slugify(text)
      if (!slug) slug = 'heading'

      const count = seen.get(slug) ?? 0
      seen.set(slug, count + 1)

      return count === 0 ? slug : `${slug}-${count}`
    },
  }
}
