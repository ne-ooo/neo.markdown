/**
 * GFM Features benchmarks
 * Tests performance of GitHub Flavored Markdown extensions
 */

import { beforeAll, bench, describe, expect } from 'vitest'
import { createParser } from '../../src/index.js'
import { marked } from 'marked'
import MarkdownIt from 'markdown-it'
import taskLists from 'markdown-it-task-lists'

// Configure marked for GFM
marked.setOptions({ gfm: true })

// Configure markdown-it for GFM
const neo = createParser({ gfm: true })
const md = new MarkdownIt({ linkify: true }).use(taskLists)

// GFM test data
const samples = {
  strikethrough: '~~deleted~~ text with ~~multiple~~ strikethrough sections',

  taskList: `
- [x] Completed task
- [ ] Pending task
- [x] Another completed
- [ ] Another pending
  `.trim(),

  table: `
| Header 1 | Header 2 | Header 3 |
| -------- | -------- | -------- |
| Cell 1   | Cell 2   | Cell 3   |
| Cell 4   | Cell 5   | Cell 6   |
| Cell 7   | Cell 8   | Cell 9   |
  `.trim(),

  tableAligned: `
| Left | Center | Right |
| :--- | :----: | ----: |
| L1   | C1     | R1    |
| L2   | C2     | R2    |
  `.trim(),

  autolinks: `
Visit https://example.com for more info.
Check out http://github.com too.
Or www.example.com works as well.
  `.trim(),

  mixedGFM: `
# GFM Features

## Task List
- [x] Implement tables
- [x] Add strikethrough
- [ ] Add more features

## Table

| Feature | Status |
| ------- | ------ |
| Tables | ✅ |
| ~~Strikethrough~~ | ✅ |
| Task lists | ✅ |

Visit https://github.com for more info.
  `.trim(),
}

function canonicalize(html: string): string {
  return html
    .replace(/<(\/?)s>/g, '<$1del>')
    .replace(/ style="text-align:(left|center|right)"/g, ' align="$1"')
    .replace(/\sclass="[^"]*"/g, '')
    .replace(/<input\b([^>]*)>/g, (_match, attributes: string) => (
      `<input type="checkbox"${/\bchecked(?:="")?/.test(attributes) ? ' checked' : ''} disabled>`
    ))
    .replace(/>\s+</g, '><')
    .replace(/\s+/g, ' ')
    .trim()
}

beforeAll(() => {
  for (const markdown of Object.values(samples)) {
    const expected = canonicalize(neo.parse(markdown))
    expect(canonicalize(String(marked.parse(markdown)))).toBe(expected)
    expect(canonicalize(md.render(markdown))).toBe(expected)
  }
})

describe('GFM Features Performance', () => {
  describe('Strikethrough', () => {
    bench('neo.markdown', () => {
      neo.parse(samples.strikethrough)
    })

    bench('marked', () => {
      marked(samples.strikethrough)
    })

    bench('markdown-it', () => {
      md.render(samples.strikethrough)
    })
  })

  describe('Task Lists', () => {
    bench('neo.markdown', () => {
      neo.parse(samples.taskList)
    })

    bench('marked', () => {
      marked(samples.taskList)
    })

    bench('markdown-it', () => {
      md.render(samples.taskList)
    })
  })

  describe('Tables', () => {
    bench('neo.markdown', () => {
      neo.parse(samples.table)
    })

    bench('marked', () => {
      marked(samples.table)
    })

    bench('markdown-it', () => {
      md.render(samples.table)
    })
  })

  describe('Tables with Alignment', () => {
    bench('neo.markdown', () => {
      neo.parse(samples.tableAligned)
    })

    bench('marked', () => {
      marked(samples.tableAligned)
    })

    bench('markdown-it', () => {
      md.render(samples.tableAligned)
    })
  })

  describe('Autolinks', () => {
    bench('neo.markdown', () => {
      neo.parse(samples.autolinks)
    })

    bench('marked', () => {
      marked(samples.autolinks)
    })

    bench('markdown-it', () => {
      md.render(samples.autolinks)
    })
  })

  describe('Mixed GFM Features', () => {
    bench('neo.markdown', () => {
      neo.parse(samples.mixedGFM)
    })

    bench('marked', () => {
      marked(samples.mixedGFM)
    })

    bench('markdown-it', () => {
      md.render(samples.mixedGFM)
    })
  })
})
