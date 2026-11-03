/**
 * Boot stall window: fires only after a full quiet period, re-arms on every
 * reported progress, keeps waiting while the silence is expected (a bundle on
 * the wire), and stops for good on dispose.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { watchStall } from '../src/boot-stall.ts'

const STALL = 8_000

afterEach(() => {
  vi.useRealTimers()
})

describe('watchStall', () => {
  it('fires only after one quiet window', async () => {
    vi.useFakeTimers()
    const watch = watchStall(STALL)
    let fired = false
    void watch.stalled.then(() => { fired = true })
    await vi.advanceTimersByTimeAsync(STALL - 1)
    expect(fired).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(fired).toBe(true)
    watch.dispose()
  })

  it('re-arms on notify (progress is not a stall)', async () => {
    vi.useFakeTimers()
    const watch = watchStall(STALL)
    let fired = false
    void watch.stalled.then(() => { fired = true })
    for (let round = 0; round < 3; round += 1) {
      await vi.advanceTimersByTimeAsync(STALL - 1)
      watch.notify()
    }
    expect(fired).toBe(false)
    await vi.advanceTimersByTimeAsync(STALL)
    expect(fired).toBe(true)
    watch.dispose()
  })

  it('keeps waiting while blocked() (a bundle on the wire has no deadline here)', async () => {
    vi.useFakeTimers()
    let blocked = true
    const watch = watchStall(STALL, () => blocked)
    let fired = false
    void watch.stalled.then(() => { fired = true })
    await vi.advanceTimersByTimeAsync(STALL * 3)
    expect(fired).toBe(false)
    blocked = false
    await vi.advanceTimersByTimeAsync(STALL)
    expect(fired).toBe(true)
    watch.dispose()
  })

  it('dispose stops the window and ignores later notifications', async () => {
    vi.useFakeTimers()
    const watch = watchStall(STALL)
    let fired = false
    void watch.stalled.then(() => { fired = true })
    watch.dispose()
    watch.notify()
    await vi.advanceTimersByTimeAsync(STALL * 2)
    expect(fired).toBe(false)
  })
})
