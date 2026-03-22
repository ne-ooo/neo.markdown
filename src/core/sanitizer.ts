/**
 * Server-side HTML sanitizer for neo.markdown
 *
 * Regex/string-based sanitizer that runs without DOM dependencies.
 * Works in Node.js, Deno, Bun, and edge runtimes.
 */

/**
 * Default allowed tags (GitHub README-compatible)
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
  'img', 'picture', 'source', 'video', 'audio',
])

/**
 * Tags that are ALWAYS blocked regardless of allowedTags
 */
const ALWAYS_BLOCKED_TAGS = new Set([
  'script', 'iframe', 'object', 'embed', 'form', 'input',
  'textarea', 'select', 'button', 'style', 'link', 'meta',
  'base', 'applet', 'svg', 'math',
])

/**
 * Default allowed attributes per tag
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
}

/**
 * Event handler attribute pattern (onclick, onerror, onload, etc.)
 */
const EVENT_HANDLER_RE = /^on\w+$/i

/**
 * Always-blocked attributes regardless of config
 */
const ALWAYS_BLOCKED_ATTRS = new Set([
  'srcdoc', 'formaction', 'xlink:href',
])

/**
 * Dangerous URL protocols
 */
const DANGEROUS_PROTOCOL_RE = /^\s*(?:javascript|data|vbscript|file|about|blob)\s*:/i

/**
 * Matches HTML entities that encode '<' to detect entity-encoded tags
 */
const ENCODED_LT_RE = /&#(?:0*60|x0*3c);/gi

/**
 * Matches HTML entities that encode '>'
 */
const ENCODED_GT_RE = /&#(?:0*62|x0*3e);/gi

/**
 * Matches HTML comments
 */
const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g

/**
 * Matches an opening or closing HTML tag with its attributes
 */
const HTML_TAG_RE = /<\/?([a-zA-Z][a-zA-Z0-9-]*)\s*([^>]*?)\s*\/?>/g

/**
 * Tags whose content (not just the tag) should be stripped entirely.
 * These are tags that can execute code or load external resources dangerously.
 */
const STRIP_CONTENT_TAGS = new Set([
  'script', 'style', 'applet',
])

/**
 * Matches a single attribute: name="value", name='value', or name=value, or boolean attribute
 */
const ATTR_RE = /([a-zA-Z_:][\w:.-]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g

/**
 * Aria attribute pattern
 */
const ARIA_ATTR_RE = /^aria-[\w-]+$/i

/**
 * Data attribute pattern
 */
const DATA_ATTR_RE = /^data-[\w-]+$/i

/**
 * Sanitizer configuration
 */
export interface SanitizerConfig {
  allowedTags: Set<string>
  allowedAttributes: Record<string, Set<string>>
  allowStyle: boolean
}

/**
 * Build sanitizer config from parser options
 */
export function buildSanitizerConfig(options: {
  allowedTags?: string[]
  allowedAttributes?: Record<string, string[]>
  allowStyle?: boolean
}): SanitizerConfig {
  // Start with defaults
  let allowedTags = new Set(DEFAULT_ALLOWED_TAGS)

  // Extend with user tags (if provided)
  if (options.allowedTags) {
    for (const tag of options.allowedTags) {
      const lower = tag.toLowerCase()
      // Never allow always-blocked tags
      if (!ALWAYS_BLOCKED_TAGS.has(lower)) {
        allowedTags.add(lower)
      }
    }
  }

  // Build allowed attributes
  const allowedAttributes: Record<string, Set<string>> = {}
  for (const [tag, attrs] of Object.entries(DEFAULT_ALLOWED_ATTRIBUTES)) {
    allowedAttributes[tag] = new Set(attrs)
  }

  // Extend with user attributes (if provided)
  if (options.allowedAttributes) {
    for (const [tag, attrs] of Object.entries(options.allowedAttributes)) {
      const lower = tag.toLowerCase()
      if (!allowedAttributes[lower]) {
        allowedAttributes[lower] = new Set()
      }
      for (const attr of attrs) {
        allowedAttributes[lower].add(attr.toLowerCase())
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
 * Check if an attribute is allowed for a given tag
 */
function isAttributeAllowed(
  tagName: string,
  attrName: string,
  attrValue: string,
  config: SanitizerConfig
): { allowed: boolean; sanitizedValue?: string } {
  const lowerAttr = attrName.toLowerCase()

  // Always block event handlers
  if (EVENT_HANDLER_RE.test(lowerAttr)) {
    return { allowed: false }
  }

  // Always block certain attributes
  if (ALWAYS_BLOCKED_ATTRS.has(lowerAttr)) {
    return { allowed: false }
  }

  // Style attribute: controlled by explicit opt-in
  if (lowerAttr === 'style') {
    return { allowed: config.allowStyle }
  }

  // Check URL attributes for dangerous protocols
  if (isUrlAttribute(lowerAttr)) {
    const decodedValue = decodeEntities(attrValue)
    if (DANGEROUS_PROTOCOL_RE.test(decodedValue)) {
      return { allowed: false }
    }
  }

  // Check global attributes (*)
  const globalAttrs = config.allowedAttributes['*']
  if (globalAttrs?.has(lowerAttr)) {
    return { allowed: true }
  }

  // Check aria-* attributes (always allowed for accessibility)
  if (ARIA_ATTR_RE.test(lowerAttr)) {
    return { allowed: true }
  }

  // Check data-* attributes (always allowed)
  if (DATA_ATTR_RE.test(lowerAttr)) {
    return { allowed: true }
  }

  // Check tag-specific attributes
  const tagAttrs = config.allowedAttributes[tagName]
  if (tagAttrs?.has(lowerAttr)) {
    return { allowed: true }
  }

  return { allowed: false }
}

/**
 * Check if an attribute name holds a URL value
 */
function isUrlAttribute(attr: string): boolean {
  return attr === 'href' || attr === 'src' || attr === 'action'
    || attr === 'formaction' || attr === 'poster' || attr === 'background'
    || attr === 'cite' || attr === 'data' || attr === 'srcset'
}

/**
 * Decode common HTML entities in attribute values for protocol checking
 */
function decodeEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&tab;/gi, '\t')
    .replace(/&newline;/gi, '\n')
}

/**
 * Sanitize HTML attributes for a given tag
 * Returns sanitized attribute string
 */
function sanitizeAttributes(tagName: string, attrString: string, config: SanitizerConfig): string {
  const attrs: string[] = []

  let match: RegExpExecArray | null
  const re = new RegExp(ATTR_RE.source, 'g')

  while ((match = re.exec(attrString)) !== null) {
    const name = match[1]
    const value = match[2] ?? match[3] ?? match[4] ?? ''

    const result = isAttributeAllowed(tagName, name, value, config)
    if (result.allowed) {
      const safeValue = result.sanitizedValue ?? value
      attrs.push(`${name.toLowerCase()}="${safeValue}"`)
    }
  }

  return attrs.length > 0 ? ' ' + attrs.join(' ') : ''
}

/**
 * Sanitize HTML string — removes disallowed tags and attributes
 *
 * This is a server-side sanitizer with no DOM dependency.
 * It runs as a post-processing step after markdown rendering.
 *
 * @param html - HTML string to sanitize
 * @param config - Sanitizer configuration
 * @returns Sanitized HTML string
 */
export function sanitizeHtml(html: string, config: SanitizerConfig): string {
  // Step 1: Decode entity-encoded angle brackets to prevent bypass
  // e.g., &#60;script&#62; → <script> → then stripped
  let result = html
    .replace(ENCODED_LT_RE, '<')
    .replace(ENCODED_GT_RE, '>')

  // Step 2: Remove HTML comments (can contain script vectors)
  result = result.replace(HTML_COMMENT_RE, '')

  // Step 2.5: Strip content inside dangerous tags (script, style, etc.)
  for (const tag of STRIP_CONTENT_TAGS) {
    const contentRe = new RegExp(`<${tag}[^>]*>[\\s\\S]*?<\\/${tag}>`, 'gi')
    result = result.replace(contentRe, '')
  }

  // Step 3: Process tags
  result = result.replace(HTML_TAG_RE, (fullMatch, tagName: string, attrString: string) => {
    const lowerTag = tagName.toLowerCase()
    const isClosing = fullMatch.startsWith('</')

    // Always-blocked tags — strip entirely
    if (ALWAYS_BLOCKED_TAGS.has(lowerTag)) {
      return ''
    }

    // Check against allowlist
    if (!config.allowedTags.has(lowerTag)) {
      return ''
    }

    // Allowed tag — sanitize its attributes
    if (isClosing) {
      return `</${lowerTag}>`
    }

    const sanitizedAttrs = sanitizeAttributes(lowerTag, attrString, config)
    const selfClosing = fullMatch.endsWith('/>') ? ' /' : ''
    return `<${lowerTag}${sanitizedAttrs}${selfClosing}>`
  })

  // Step 4: Handle split-tag bypass attempts like <scr<script>ipt>
  // Run a second pass to catch any tags that became valid after the first strip
  if (/<[a-zA-Z]/.test(result)) {
    let prev = ''
    while (prev !== result) {
      prev = result
      result = result.replace(HTML_TAG_RE, (fullMatch, tagName: string, attrString: string) => {
        const lowerTag = tagName.toLowerCase()
        const isClosing = fullMatch.startsWith('</')

        if (ALWAYS_BLOCKED_TAGS.has(lowerTag)) {
          return ''
        }

        if (!config.allowedTags.has(lowerTag)) {
          return ''
        }

        if (isClosing) {
          return `</${lowerTag}>`
        }

        const sanitizedAttrs = sanitizeAttributes(lowerTag, attrString, config)
        const selfClosing = fullMatch.endsWith('/>') ? ' /' : ''
        return `<${lowerTag}${sanitizedAttrs}${selfClosing}>`
      })
    }
  }

  // Step 5: Block autoplay on video/audio
  result = result.replace(/<(video|audio)([^>]*)\bautoplay\b/gi, '<$1$2')

  return result
}
