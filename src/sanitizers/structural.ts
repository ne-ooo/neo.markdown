/** Built-in structural HTML sanitizer. */

import structuralSanitizeHtml from 'sanitize-html'
import {
  ALWAYS_BLOCKED_TAGS,
  buildAllowedAttributes,
  isSanitizerConfigStable,
} from '../core/sanitizer.js'
import type { SanitizerConfig } from '../core/types.js'

const SAFE_COLOR_VALUES = [
  /^#[\da-f]{3,8}$/i,
  /^(?:rgb|hsl)a?\(\s*[-\d.%]+(?:[\s,/]+[-\d.%]+){2,3}\s*\)$/i,
  /^[a-z]+$/i,
]

const SAFE_INLINE_STYLES: Record<string, RegExp[]> = {
  'color': SAFE_COLOR_VALUES,
  'background-color': SAFE_COLOR_VALUES,
  'font-style': [/^(?:normal|italic|oblique)$/i],
  'font-weight': [/^(?:normal|bold|bolder|lighter|[1-9]00)$/i],
  'text-align': [/^(?:left|right|center|justify|start|end)$/i],
  'text-decoration': [/^(?:none|underline|overline|line-through)(?:\s+(?:underline|overline|line-through))*$/i],
  'white-space': [/^(?:normal|nowrap|pre|pre-wrap|pre-line|break-spaces)$/i],
}

const RESERVED_EMBED_DATA_ATTRIBUTE = /^data-(?:embed(?:-|$)|gist-(?:src|height)$|neo-embed(?:-|$))/i
type StructuralSanitizerOptions = NonNullable<Parameters<typeof structuralSanitizeHtml>[1]>
const stableOptions = new WeakMap<SanitizerConfig, StructuralSanitizerOptions>()

function hardenSanitizedTag(
  tagName: string,
  attribs: Record<string, string>
): { tagName: string; attribs: Record<string, string> } {
  const filtered = { ...attribs }
  for (const name of Object.keys(filtered)) {
    if (RESERVED_EMBED_DATA_ATTRIBUTE.test(name)) delete filtered[name]
  }

  if (filtered['class']) {
    const className = filtered['class']
      .split(/\s+/)
      .filter((name) => name && name !== 'twitter-tweet')
      .join(' ')
    if (className) filtered['class'] = className
    else delete filtered['class']
  }

  if (tagName.toLowerCase() === 'a') {
    const target = filtered['target']?.trim().toLowerCase()
    const rel = (filtered['rel'] ?? '')
      .split(/\s+/)
      .filter((value) => value && value.toLowerCase() !== 'opener')

    if (target && target !== '_self' && target !== '_parent' && target !== '_top') {
      const lowerRel = new Set(rel.map((value) => value.toLowerCase()))
      if (!lowerRel.has('noopener')) rel.push('noopener')
      if (!lowerRel.has('noreferrer')) rel.push('noreferrer')
    }

    if (rel.length > 0) filtered['rel'] = rel.join(' ')
    else delete filtered['rel']
  }

  return { tagName, attribs: filtered }
}

function buildStructuralOptions(config: SanitizerConfig): StructuralSanitizerOptions {
  return {
    allowedTags: [...config.allowedTags].filter((tag) => !ALWAYS_BLOCKED_TAGS.has(tag)),
    allowedAttributes: buildAllowedAttributes(config),
    allowedSchemes: ['http', 'https', 'ftp', 'mailto', 'tel'],
    allowProtocolRelative: false,
    disallowedTagsMode: 'discard',
    nonTextTags: ['script', 'style', 'textarea', 'option'],
    allowVulnerableTags: false,
    nestingLimit: 100,
    enforceHtmlBoundary: false,
    parseStyleAttributes: config.allowStyle,
    allowedStyles: config.allowStyle ? { '*': SAFE_INLINE_STYLES } : undefined,
    transformTags: { '*': hardenSanitizedTag },
    exclusiveFilter: (frame) => (
      frame.tag === 'input'
      && (
        frame.attribs['type']?.toLowerCase() !== 'checkbox'
        || !Object.hasOwn(frame.attribs, 'disabled')
      )
    ),
  }
}

/** Sanitize an HTML fragment with structural parsing and a strict allowlist. */
export function sanitizeHtml(html: string, config: SanitizerConfig): string {
  let options = stableOptions.get(config)
  if (!options) {
    options = buildStructuralOptions(config)
    if (isSanitizerConfigStable(config)) stableOptions.set(config, options)
  }
  return structuralSanitizeHtml(html, options)
}
