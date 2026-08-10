/** Built-in structural HTML sanitizer. */

import structuralSanitizeHtml from 'sanitize-html'
import {
  ALWAYS_BLOCKED_TAGS,
  buildAllowedAttributes,
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

/** Sanitize an HTML fragment with structural parsing and a strict allowlist. */
export function sanitizeHtml(html: string, config: SanitizerConfig): string {
  return structuralSanitizeHtml(html, {
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
    exclusiveFilter: (frame) => (
      frame.tag === 'input'
      && (
        frame.attribs['type']?.toLowerCase() !== 'checkbox'
        || !Object.hasOwn(frame.attribs, 'disabled')
      )
    ),
  })
}
