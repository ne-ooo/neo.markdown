/**
 * HTML escaping utilities for XSS protection
 */

/**
 * HTML entities to escape
 */
const ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

/**
 * Regex for matching characters that need escaping
 */
const ESCAPE_REGEX = /[&<>"']/g

/**
 * Escape HTML entities to prevent XSS
 *
 * @param html - HTML string to escape
 * @returns Escaped HTML string
 *
 * @example
 * escape('<script>alert("XSS")</script>')
 * // => '&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;'
 */
export function escape(html: string): string {
  return html.replace(ESCAPE_REGEX, (char) => ESCAPE_MAP[char] || char)
}

/**
 * Unescape HTML entities
 *
 * @param html - HTML string to unescape
 * @returns Unescaped HTML string
 */
export function unescape(html: string): string {
  return html
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

/**
 * Dangerous protocols that should be blocked in links
 * Phase 5: Enhanced to block more attack vectors
 */
const DANGEROUS_PROTOCOLS = /^(javascript|data|vbscript|file|about|blob):/i

/**
 * Check if a URL uses a dangerous protocol
 *
 * @param url - URL to check
 * @returns true if URL is safe
 */
export function isSafeUrl(url: string): boolean {
  const trimmed = url.trim()
  return !DANGEROUS_PROTOCOLS.test(trimmed)
}

/**
 * Sanitize a URL by removing dangerous protocols and characters
 * Phase 5: Enhanced to handle null bytes and other attack vectors
 *
 * @param url - URL to sanitize
 * @returns Sanitized URL or empty string if dangerous
 */
export function sanitizeUrl(url: string): string {
  // Remove null bytes and other control characters
  const cleaned = url.replace(/[\x00-\x1F\x7F]/g, '')

  // Check if the cleaned URL is safe
  return isSafeUrl(cleaned) ? cleaned : ''
}
