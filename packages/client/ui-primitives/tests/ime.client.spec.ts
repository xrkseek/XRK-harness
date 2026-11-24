import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  COMPOSITION_GRACE_MS,
  createCompositionWatch,
} from '../src/ime.ts'

describe('createCompositionWatch', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('tracks native composition and the post-end grace window', () => {
    vi.useFakeTimers()
    const root = document.createElement('div')
    const changes: boolean[] = []
    const watch = createCompositionWatch({
      graceMs: COMPOSITION_GRACE_MS,
      onChange: (native) => { changes.push(native) },
    })
    watch.bind(root)

    root.dispatchEvent(new Event('compositionstart'))
    expect(watch.isNativeComposing()).toBe(true)
    expect(watch.recentlyComposing()).toBe(true)
    expect(changes).toEqual([true])

    root.dispatchEvent(new Event('compositionend'))
    expect(watch.isNativeComposing()).toBe(false)
    expect(watch.recentlyComposing()).toBe(true)
    expect(changes).toEqual([true, false])

    vi.advanceTimersByTime(COMPOSITION_GRACE_MS + 1)
    expect(watch.recentlyComposing()).toBe(false)

    watch.dispose()
  })
})
