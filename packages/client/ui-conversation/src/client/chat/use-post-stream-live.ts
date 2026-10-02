/**
 * Keep a transcript row paint-live for a short grace after streaming ends.
 * Dropping `data-live` the same frame as settle flips `content-visibility`
 * from `visible` to `auto`; Chromium can skip the row for a beat so an
 * expanded Think body vanishes then reappears.
 */
import { useEffect, useState } from 'react'

/** Default settle grace — long enough for one layout+paint after status flip. */
export const POST_STREAM_LIVE_GRACE_MS = 480

/**
 * @param streaming - true while the assistant step is still the live stream.
 * @param graceMs - how long to stay live after streaming clears.
 * @returns whether the row should keep `content-visibility: visible`.
 */
export function usePostStreamLive(
  streaming: boolean,
  graceMs: number = POST_STREAM_LIVE_GRACE_MS,
): boolean {
  const [grace, setGrace] = useState(streaming)
  useEffect(() => {
    if (streaming) {
      setGrace(true)
      return
    }
    if (typeof window === 'undefined') {
      setGrace(false)
      return
    }
    const timer = window.setTimeout(() => {
      setGrace(false)
    }, graceMs)
    return () => {
      window.clearTimeout(timer)
    }
  }, [streaming, graceMs])
  return streaming || grace
}
