/**
 * Large document benchmarks
 * Tests performance with realistic large markdown files
 */

import { beforeAll, bench, describe, expect } from 'vitest'
import { createParser } from '../../src/index.js'
import { marked } from 'marked'
import MarkdownIt from 'markdown-it'
import taskLists from 'markdown-it-task-lists'

const neo = createParser({ gfm: true })
const md = new MarkdownIt({ linkify: true }).use(taskLists)
marked.setOptions({ gfm: true })

// Generate large documents
function generateLargeDocument(size: 'small' | 'medium' | 'large'): string {
  const sections = size === 'small' ? 10 : size === 'medium' ? 50 : 200

  const parts: string[] = []

  for (let i = 1; i <= sections; i++) {
    parts.push(`
## Section ${i}

This is section ${i} with **bold** text, *italic* text, and \`inline code\`.

### Subsection ${i}.1

Here's a list:

- Item 1 with [link](https://example.com/${i})
- Item 2 with more text
- Item 3 with **nested** *emphasis*

### Subsection ${i}.2

\`\`\`javascript
function example${i}() {
  console.log("Section ${i}");
  return ${i};
}
\`\`\`

> Blockquote in section ${i}
> with multiple lines

${i % 5 === 0 ? `
| Col 1 | Col 2 | Col 3 |
| ----- | ----- | ----- |
| ${i} | ${i * 2} | ${i * 3} |
| A | B | C |
` : ''}
    `.trim())
  }

  return parts.join('\n\n')
}

// Pre-generate documents (don't include generation time in benchmark)
const smallDoc = generateLargeDocument('small')
const mediumDoc = generateLargeDocument('medium')
const largeDoc = generateLargeDocument('large')

function canonicalize(html: string): string {
  return html
    .replace(/<(\/?)s>/g, '<$1del>')
    .replace(/&#39;/g, "'")
    .replace(/\s+<\/code>/g, '</code>')
    .replace(/<li><p>([\s\S]*?)<\/p>(?=<(?:ul|ol)>)/g, '<li>$1 ')
    .replace(/>\s+</g, '><')
    .replace(/\s+/g, ' ')
    .trim()
}

beforeAll(() => {
  for (const markdown of [smallDoc, mediumDoc, largeDoc]) {
    const expected = canonicalize(neo.parse(markdown))
    expect(canonicalize(String(marked.parse(markdown)))).toBe(expected)
    expect(canonicalize(md.render(markdown))).toBe(expected)
  }
})

describe('Large Document Performance', () => {
  describe('Small Document (~10 sections, ~4KB)', () => {
    bench('neo.markdown', () => {
      neo.parse(smallDoc)
    })

    bench('marked', () => {
      marked(smallDoc)
    })

    bench('markdown-it', () => {
      md.render(smallDoc)
    })
  })

  describe('Medium Document (~50 sections, ~20KB)', () => {
    bench('neo.markdown', () => {
      neo.parse(mediumDoc)
    })

    bench('marked', () => {
      marked(mediumDoc)
    })

    bench('markdown-it', () => {
      md.render(mediumDoc)
    })
  })

  describe('Large Document (~200 sections, ~82KB)', () => {
    bench('neo.markdown', () => {
      neo.parse(largeDoc)
    })

    bench('marked', () => {
      marked(largeDoc)
    })

    bench('markdown-it', () => {
      md.render(largeDoc)
    })
  })
})

// Report document sizes
console.log('Document sizes:')
console.log('  Small:', smallDoc.length, 'bytes')
console.log('  Medium:', mediumDoc.length, 'bytes')
console.log('  Large:', largeDoc.length, 'bytes')
