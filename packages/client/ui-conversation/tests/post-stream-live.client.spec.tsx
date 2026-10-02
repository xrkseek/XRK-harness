// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, renderHook, act } from '@testing-library/react'
import {
  POST_STREAM_LIVE_GRACE_MS,
  usePostStreamLive,
} from '../src/client/chat/use-post-stream-live.ts'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('usePostStreamLive', () => {
  it('stays live through streaming and a short settle grace', () => {
    vi.useFakeTimers()
    const { result, rerender } = renderHook(
      ({ streaming }) => usePostStreamLive(streaming, POST_STREAM_LIVE_GRACE_MS),
      { initialProps: { streaming: true } },
    )
    expect(result.current).toBe(true)

    rerender({ streaming: false })
    expect(result.current).toBe(true)

    act(() => {
      vi.advanceTimersByTime(POST_STREAM_LIVE_GRACE_MS - 1)
    })
    expect(result.current).toBe(true)

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(result.current).toBe(false)
  })

  it('re-arms grace when streaming starts again', () => {
    vi.useFakeTimers()
    const { result, rerender } = renderHook(
      ({ streaming }) => usePostStreamLive(streaming, 100),
      { initialProps: { streaming: false } },
    )
    expect(result.current).toBe(false)

    rerender({ streaming: true })
    expect(result.current).toBe(true)
    rerender({ streaming: false })
    expect(result.current).toBe(true)

    act(() => {
      vi.advanceTimersByTime(100)
    })
    expect(result.current).toBe(false)
  })
})
