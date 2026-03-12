/**
 * GFM Features benchmarks
 * Tests performance of GitHub Flavored Markdown extensions
 */

import { bench, describe } from 'vitest'
import { parse as neoParse } from '../../src/index.js'
import { marked } from 'marked'
import MarkdownIt from 'markdown-it'

// Configure marked for GFM
marked.setOptions({ gfm: true })

// Configure markdown-it for GFM
const md = new MarkdownIt()

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

describe('GFM Features Performance', () => {
  describe('Strikethrough', () => {
    bench('neo.markdown', () => {
      neoParse(samples.strikethrough)
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
      neoParse(samples.taskList)
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
      neoParse(samples.table)
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
      neoParse(samples.tableAligned)
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
      neoParse(samples.autolinks)
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
      neoParse(samples.mixedGFM)
    })

    bench('marked', () => {
      marked(samples.mixedGFM)
    })

    bench('markdown-it', () => {
      md.render(samples.mixedGFM)
    })
  })
})
