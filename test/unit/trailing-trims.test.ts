import { describe, expect, it } from 'vitest'
import { headingText } from '../../src/blocks/rules/heading.js'
import { trimAutolinkPunctuation } from '../../src/inline/gfm-support.js'

// The patterns these scans replaced, which retried a long trailing run from
// every offset. The scans must return what they returned.
const oldHeadingText = (value: string) =>
  value.replace(/(?:^|[ \t]+)#+[ \t]*$/, '').replace(/^[ \t]+|[ \t]+$/g, '')
const oldAutolinkTrim = (value: string) => value.replace(/[?!.,:*_~]+$/, '')

function* corpus(alphabet: string, count: number, maxLength: number, seed: number): Generator<string> {
  let state = seed
  const next = () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 2 ** 32
  }
  for (let index = 0; index < count; index++) {
    let text = ''
    const length = Math.floor(next() * maxLength)
    for (let char = 0; char < length; char++) text += alphabet[Math.floor(next() * alphabet.length)]
    yield text
  }
}

describe('trailing-run scans return what their patterns returned', () => {
  it('heading text', () => {
    const edges = ['Title', 'Title #', 'Title ## ', '#', '##', ' # ', 'a#', 'a #b', 'a\t##\t', '#a#', 'x #\t#', 'a ## ##', ' \t ', '']
    for (const text of [...edges, ...corpus(' \t#a\\ ', 50_000, 14, 3)]) {
      expect(headingText(text), JSON.stringify(text)).toBe(oldHeadingText(text))
    }
  })

  it('autolink trailing punctuation', () => {
    const edges = ['http://a.b/x.', 'http://a.b/x?!', 'www.x.y,', 'a*_~', 'http://a.b/', '?!', 'x.y.z...', '']
    for (const text of [...edges, ...corpus('?!.,:*_~a/)&;', 50_000, 14, 5)]) {
      expect(trimAutolinkPunctuation(text), JSON.stringify(text)).toBe(oldAutolinkTrim(text))
    }
  })
})
