/**
 * Large document benchmarks
 * Tests performance with realistic large markdown files
 */

import { bench, describe } from 'vitest'
import { parse as neoParse } from '../../src/index.js'
import { marked } from 'marked'
import MarkdownIt from 'markdown-it'

const md = new MarkdownIt()
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

describe('Large Document Performance', () => {
  describe('Small Document (~10 sections, ~1KB)', () => {
    bench('neo.markdown', () => {
      neoParse(smallDoc)
    })

    bench('marked', () => {
      marked(smallDoc)
    })

    bench('markdown-it', () => {
      md.render(smallDoc)
    })
  })

  describe('Medium Document (~50 sections, ~5KB)', () => {
    bench('neo.markdown', () => {
      neoParse(mediumDoc)
    })

    bench('marked', () => {
      marked(mediumDoc)
    })

    bench('markdown-it', () => {
      md.render(mediumDoc)
    })
  })

  describe('Large Document (~200 sections, ~20KB)', () => {
    bench('neo.markdown', () => {
      neoParse(largeDoc)
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
