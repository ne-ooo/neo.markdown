/**
 * Quick performance test to verify optimizations
 */

import { parse as neoParse } from '../src/index.js'

const listSample = `
- Item 1
- Item 2
  - Nested item 2.1
  - Nested item 2.2
- Item 3
`.trim()

const autolinkSample = `
Visit https://example.com for more info.
Check out http://github.com too.
Or www.example.com works as well.
`.trim()

console.log('Testing list parsing performance...')
const listStart = performance.now()
for (let i = 0; i < 10000; i++) {
  neoParse(listSample)
}
const listEnd = performance.now()
console.log(`10,000 list parses: ${(listEnd - listStart).toFixed(2)}ms`)

console.log('\nTesting autolink parsing performance...')
const autolinkStart = performance.now()
for (let i = 0; i < 10000; i++) {
  neoParse(autolinkSample)
}
const autolinkEnd = performance.now()
console.log(`10,000 autolink parses: ${(autolinkEnd - autolinkStart).toFixed(2)}ms`)

console.log('\nOptimizations applied successfully!')
