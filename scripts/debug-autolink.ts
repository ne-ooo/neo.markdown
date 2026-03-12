/**
 * Debug autolink parsing
 */

import { parse } from '../src/index.js'
import { InlineTokenizer } from '../src/core/inline-tokenizer.js'

console.log('Testing autolink parsing...\n')

const input = 'Visit https://example.com for info'
console.log('Input:', input)

const result = parse(input)
console.log('Output:', result)

// Test inline tokenizer directly
const tokenizer = new InlineTokenizer()
const tokens = tokenizer.tokenize(input)
console.log('\nInline tokens:', JSON.stringify(tokens, null, 2))
