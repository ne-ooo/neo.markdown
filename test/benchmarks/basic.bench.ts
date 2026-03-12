/**
 * Basic parsing benchmarks
 * Compares @lpm.dev/neo.markdown with marked.js and markdown-it
 */

import { bench, describe } from 'vitest'
import { parse as neoParse } from '../../src/index.js'
import { marked } from 'marked'
import MarkdownIt from 'markdown-it'

const md = new MarkdownIt()

// Test data
const samples = {
  simple: 'This is **bold** and *italic* text.',

  paragraph: `
This is a paragraph with **bold**, *italic*, and \`code\`.
It has multiple lines and [links](https://example.com).

And multiple paragraphs too.
  `.trim(),

  heading: `
# Heading 1
## Heading 2
### Heading 3

Some content here.
  `.trim(),

  list: `
- Item 1
- Item 2
  - Nested item 2.1
  - Nested item 2.2
- Item 3
  `.trim(),

  codeBlock: `
Here's some code:

\`\`\`javascript
function hello() {
  console.log("Hello, world!");
}
\`\`\`

That was code.
  `.trim(),

  mixed: `
# Document Title

This is a **comprehensive** test with *multiple* features.

## Features

- **Bold** text
- *Italic* text
- \`Inline code\`
- [Links](https://example.com)

### Code Example

\`\`\`typescript
const x: number = 42;
console.log(x);
\`\`\`

> Blockquote with **bold** text

1. Ordered list
2. Second item
3. Third item
  `.trim(),
}

describe('Basic Parsing Performance', () => {
  describe('Simple Text', () => {
    bench('neo.markdown', () => {
      neoParse(samples.simple)
    })

    bench('marked', () => {
      marked(samples.simple)
    })

    bench('markdown-it', () => {
      md.render(samples.simple)
    })
  })

  describe('Paragraph with Inline Elements', () => {
    bench('neo.markdown', () => {
      neoParse(samples.paragraph)
    })

    bench('marked', () => {
      marked(samples.paragraph)
    })

    bench('markdown-it', () => {
      md.render(samples.paragraph)
    })
  })

  describe('Headings', () => {
    bench('neo.markdown', () => {
      neoParse(samples.heading)
    })

    bench('marked', () => {
      marked(samples.heading)
    })

    bench('markdown-it', () => {
      md.render(samples.heading)
    })
  })

  describe('Lists', () => {
    bench('neo.markdown', () => {
      neoParse(samples.list)
    })

    bench('marked', () => {
      marked(samples.list)
    })

    bench('markdown-it', () => {
      md.render(samples.list)
    })
  })

  describe('Code Blocks', () => {
    bench('neo.markdown', () => {
      neoParse(samples.codeBlock)
    })

    bench('marked', () => {
      marked(samples.codeBlock)
    })

    bench('markdown-it', () => {
      md.render(samples.codeBlock)
    })
  })

  describe('Mixed Content', () => {
    bench('neo.markdown', () => {
      neoParse(samples.mixed)
    })

    bench('marked', () => {
      marked(samples.mixed)
    })

    bench('markdown-it', () => {
      md.render(samples.mixed)
    })
  })
})
