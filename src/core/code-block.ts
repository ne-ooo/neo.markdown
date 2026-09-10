import type { CodeBlockContext, CodeBlockMetadata, CodeMetadataDiagnostic } from './types.js'
import { decodeMarkdown } from '../utils/markdown-text.js'

export const MAX_CODE_META_LENGTH = 16_384
export const MAX_CODE_META_ENTRIES = 256
export const MAX_HIGHLIGHT_LINES = 10_000

/** Parse bounded, whitespace-separated flags, key=value pairs, and {line,ranges}. */
export function parseCodeMetadata(rawMeta = '', maxLines = MAX_HIGHLIGHT_LINES): CodeBlockMetadata {
  const attributes: Record<string, string | true> = Object.create(null)
  const diagnostics: CodeMetadataDiagnostic[] = []
  const highlights = new Set<number>()
  const source = rawMeta.slice(0, MAX_CODE_META_LENGTH)
  const limit = Number.isSafeInteger(maxLines) && maxLines > 0 ? Math.min(maxLines, MAX_HIGHLIGHT_LINES) : 0
  let index = 0
  let entries = 0
  const diagnostic = (code: CodeMetadataDiagnostic['code'], start: number, end: number, message: string): void => {
    diagnostics.push(Object.freeze({ code, start, end, message }))
  }
  while (index < source.length) {
    while (/\s/.test(source[index] ?? '')) index++
    if (index === source.length) break
    const start = index
    if (entries++ >= MAX_CODE_META_ENTRIES) {
      diagnostic('limit-exceeded', start, rawMeta.length, 'Metadata exceeds the entry limit')
      break
    }
    if (source[index] === '{') {
      const close = source.indexOf('}', index + 1)
      if (close < 0) { diagnostic('invalid-syntax', start, source.length, 'Unclosed line range'); break }
      index = close + 1
      const range = source.slice(start + 1, close)
      if (!/^[\d,\s-]+$/.test(range)) diagnostic('invalid-syntax', start, index, 'Invalid line range')
      else {
        for (const part of range.split(',')) {
          const match = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(part.trim())
          const from = Number(match?.[1]); const to = Number(match?.[2] ?? match?.[1])
          if (!match || !Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 1 || to < from) {
            diagnostic('invalid-syntax', start, index, 'Invalid line range'); break
          }
          for (let line = from; line <= Math.min(to, limit); line++) highlights.add(line)
        }
      }
      continue
    }
    while (index < source.length && !/[\s=]/.test(source[index])) index++
    const key = source.slice(start, index)
    while (/\s/.test(source[index] ?? '')) index++
    let value: string | true = true
    let valid = /^[A-Za-z_][\w-]*$/.test(key)
    if (source[index] === '=') {
      index++
      while (/\s/.test(source[index] ?? '')) index++
      const quote = source[index]
      const quoted = quote === '"' || quote === "'"
      if (quoted) index++
      const valueStart = index
      while (index < source.length) {
        if (quoted ? source[index] === quote : /\s/.test(source[index])) break
        if (source[index] === '\\' && index + 1 < source.length) index += 2
        else index++
      }
      value = decodeMarkdown(source.slice(valueStart, index))
      if (quoted) {
        if (source[index] !== quote) valid = false
        else index++
        if (index < source.length && !/\s/.test(source[index])) {
          valid = false
          while (index < source.length && !/\s/.test(source[index])) index++
        }
      } else if (value === '') valid = false
    }
    // Never accept a value cut off by the length limit.
    if (rawMeta.length > source.length && index === source.length && !/\s/.test(rawMeta[index] ?? '')) valid = false
    if (!valid) diagnostic('invalid-syntax', start, index, 'Invalid metadata entry')
    else {
      if (Object.hasOwn(attributes, key)) diagnostic('duplicate-key', start, index, 'Duplicate metadata key. Last value wins')
      attributes[key] = value
    }
  }
  if (rawMeta.length > source.length) diagnostic('limit-exceeded', source.length, rawMeta.length, 'Metadata exceeds the length limit')
  return Object.freeze({ attributes: Object.freeze(attributes), highlightLines: Object.freeze([...highlights]), diagnostics: Object.freeze(diagnostics) })
}

const metadataByContext = new WeakMap<CodeBlockContext, CodeBlockMetadata>()

/** Parse metadata on demand and retain it only while its immutable context is live. */
export function getCodeBlockMetadata(context: CodeBlockContext): CodeBlockMetadata {
  let metadata = metadataByContext.get(context)
  if (!metadata) {
    metadata = parseCodeMetadata(context.rawMeta, context.lineCount)
    metadataByContext.set(context, metadata)
  }
  return metadata
}

export { createCodeBlockContext } from './code-context.js'
