import { afterEach, describe, expect, it, vi } from 'vitest'
import { pollTweetWidgets } from '../../src/plugins/embeds/react.js'

afterEach(() => {
  vi.useRealTimers()
})

describe('pollTweetWidgets', () => {
  it('stops after the configured maximum attempts', () => {
    vi.useFakeTimers()
    const tryLoad = vi.fn(() => false)

    pollTweetWidgets(tryLoad, { intervalMs: 10, maxAttempts: 4 })
    vi.runAllTimers()

    expect(tryLoad).toHaveBeenCalledTimes(4)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('stops immediately after a successful load', () => {
    vi.useFakeTimers()
    const tryLoad = vi.fn(() => true)

    pollTweetWidgets(tryLoad, { intervalMs: 10, maxAttempts: 100 })
    vi.runAllTimers()

    expect(tryLoad).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancels a pending retry', () => {
    vi.useFakeTimers()
    const tryLoad = vi.fn(() => false)
    const cancel = pollTweetWidgets(tryLoad, { intervalMs: 10, maxAttempts: 100 })

    cancel()
    vi.runAllTimers()

    expect(tryLoad).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })
})
