/**
 * Server-side HTML sanitization for neo.markdown.
 *
 * This module contains the sanitizer policy without a sanitizer dependency.
 * The /sanitized entry supplies the built-in structural sanitizer.
 */

import type { SanitizerConfig } from './types.js'

export type { SanitizerConfig } from './types.js'

const stableSanitizerConfigs = new WeakSet<SanitizerConfig>()

/** @internal Mark a parser-owned sanitizer policy as immutable for option caching. */
export function markSanitizerConfigStable(config: SanitizerConfig): SanitizerConfig {
  stableSanitizerConfigs.add(config)
  return config
}

/** @internal Return whether a policy is private to a parser instance. */
export function isSanitizerConfigStable(config: SanitizerConfig): boolean {
  return stableSanitizerConfigs.has(config)
}

/**
 * Default allowed tags (GitHub README-compatible).
 */
export const DEFAULT_ALLOWED_TAGS = new Set([
  // Block
  'p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'blockquote', 'pre', 'code', 'hr', 'br',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
  'details', 'summary', 'section', 'article',
  'figure', 'figcaption',
  // Inline
  'a', 'strong', 'em', 'b', 'i', 'u', 's', 'del', 'ins', 'mark',
  'small', 'sub', 'sup', 'span', 'abbr', 'cite', 'q',
  'kbd', 'samp', 'var', 'time', 'ruby', 'rt', 'rp',
  // Media
  'img', 'picture', 'source', 'video', 'audio', 'input',
])

/**
 * Tags that are never allowed, even when requested through allowedTags.
 */
export const ALWAYS_BLOCKED_TAGS = new Set([
  'script', 'iframe', 'object', 'embed', 'form',
  'textarea', 'select', 'button', 'style', 'link', 'meta',
  'base', 'applet', 'svg', 'math',
])

/**
 * Default allowed attributes per tag.
 */
export const DEFAULT_ALLOWED_ATTRIBUTES: Record<string, Set<string>> = {
  '*': new Set(['id', 'class', 'title', 'lang', 'dir', 'role']),
  'a': new Set(['href', 'rel', 'target', 'hreflang']),
  'img': new Set(['src', 'alt', 'width', 'height', 'loading', 'srcset', 'sizes']),
  'td': new Set(['align', 'valign', 'colspan', 'rowspan']),
  'th': new Set(['align', 'valign', 'colspan', 'rowspan']),
  'ol': new Set(['start', 'type', 'reversed']),
  'li': new Set(['value']),
  'details': new Set(['open']),
  'time': new Set(['datetime']),
  'source': new Set(['srcset', 'sizes', 'media', 'type']),
  'code': new Set(['class']),
  'video': new Set(['src', 'width', 'height', 'poster', 'controls', 'loading']),
  'audio': new Set(['src', 'controls']),
  'input': new Set(['type', 'checked', 'disabled']),
}

export const ALWAYS_BLOCKED_ATTRS = new Set([
  'srcdoc', 'formaction', 'xlink:href',
])

export const EVENT_HANDLER_RE = /^on[\w-]*$/i
const VALID_TAG_RE = /^[a-z][a-z0-9-]*$/
const VALID_ATTR_RE = /^[a-z_:][\w:.-]*$/

/**
 * Build sanitizer config from parser options.
 */
export function buildSanitizerConfig(options: {
  allowedTags?: string[]
  allowedAttributes?: Record<string, string[]>
  allowStyle?: boolean
}): SanitizerConfig {
  const allowedTags = new Set(DEFAULT_ALLOWED_TAGS)

  if (options.allowedTags) {
    for (const tag of options.allowedTags) {
      const lower = tag.toLowerCase()
      if (VALID_TAG_RE.test(lower) && !ALWAYS_BLOCKED_TAGS.has(lower)) {
        allowedTags.add(lower)
      }
    }
  }

  const allowedAttributes: Record<string, Set<string>> = {}
  for (const [tag, attrs] of Object.entries(DEFAULT_ALLOWED_ATTRIBUTES)) {
    allowedAttributes[tag] = new Set(attrs)
  }

  if (options.allowedAttributes) {
    for (const [tag, attrs] of Object.entries(options.allowedAttributes)) {
      const lowerTag = tag.toLowerCase()
      if (lowerTag !== '*' && !VALID_TAG_RE.test(lowerTag)) continue

      const tagAttributes = allowedAttributes[lowerTag] ?? new Set<string>()
      allowedAttributes[lowerTag] = tagAttributes

      for (const attr of attrs) {
        const lowerAttr = attr.toLowerCase()
        if (
          VALID_ATTR_RE.test(lowerAttr)
          && !EVENT_HANDLER_RE.test(lowerAttr)
          && !ALWAYS_BLOCKED_ATTRS.has(lowerAttr)
          && (lowerAttr !== 'style' || options.allowStyle === true)
        ) {
          tagAttributes.add(lowerAttr)
        }
      }
    }
  }

  return {
    allowedTags,
    allowedAttributes,
    allowStyle: options.allowStyle ?? false,
  }
}

/**
 * Convert the public Set-based attribute policy to sanitize-html's format.
 */
export function buildAllowedAttributes(config: SanitizerConfig): Record<string, string[]> {
  const attributes: Record<string, string[]> = {}

  for (const [tag, values] of Object.entries(config.allowedAttributes)) {
    attributes[tag] = [...values].filter((attr) => (
      !EVENT_HANDLER_RE.test(attr)
      && !ALWAYS_BLOCKED_ATTRS.has(attr)
      && (attr !== 'style' || config.allowStyle)
    ))
  }

  const globalAttributes = attributes['*'] ?? []
  globalAttributes.push('aria-*', 'data-*')
  if (config.allowStyle) globalAttributes.push('style')
  attributes['*'] = globalAttributes

  return attributes
}
