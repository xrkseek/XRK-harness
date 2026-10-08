/**
 * Per-Session Overview Face payload memory (stale-while-revalidate).
 *
 * Chrome tab/scroll stays in `overview-paint.ts`. This cache only keeps the last
 * successful `loadPreviewTabs` result so re-opening Overview paints immediately
 * instead of flashing「正在读取概况」and resetting summary numbers to empty.
 *
 * Soft faces still must not call `session.getSnapshot()` inside getSnapshot
 * (see `xrk-overview-uses`); this map is write-on-fetch only, read for paint.
 */
import type { PreviewTabLoad } from './preview-load.ts'

const MAX_SESSIONS = 24
const bySession = new Map<string, PreviewTabLoad>()

/** Test-only: drop every remembered Status payload. */
export function resetOverviewLoadCacheForTests(): void {
  bySession.clear()
}

/** Last successful load for one Session (undefined = never fetched / evicted). */
export function readOverviewLoadCache(sessionId: string): PreviewTabLoad | undefined {
  const row = bySession.get(sessionId)
  if (row === undefined) return undefined
  // LRU touch
  bySession.delete(sessionId)
  bySession.set(sessionId, row)
  return row
}

/** Remember a successful Face load (skip empty status — keep prior paint). */
export function writeOverviewLoadCache(sessionId: string, load: PreviewTabLoad): void {
  if (load.status === null) return
  bySession.delete(sessionId)
  bySession.set(sessionId, load)
  while (bySession.size > MAX_SESSIONS) {
    const oldest = bySession.keys().next().value
    if (oldest === undefined || oldest === sessionId) break
    bySession.delete(oldest)
  }
}
