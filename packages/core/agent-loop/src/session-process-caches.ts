/**
 * Drop process-local per-session caches that are not reconstructed from the log.
 *
 * Call on session delete and in-place log cut (`truncate` / checkpoint cut).
 * Do **not** call on resident LRU eviction alone — the session may remount and
 * the series baseline / request-header miss are cheap to keep for KV continuity
 * (same posture as `forgetRequestHeaderCache` docs).
 */

import { forgetRequestHeaderCache } from "./request-header-log.js";
import {
  breakSeriesBaseline,
  clearSeriesBaselineAnchors,
} from "./series-baseline.js";
import { clearTimeContextRefreshState } from "@xrkseek/core-system-prompt";

/** Clear one session, or every session when `sessionId` is omitted (tests). */
export function forgetSessionProcessCaches(sessionId?: string): void {
  forgetRequestHeaderCache(sessionId);
  if (sessionId === undefined) {
    clearSeriesBaselineAnchors();
    clearTimeContextRefreshState();
    return;
  }
  breakSeriesBaseline(sessionId);
  clearTimeContextRefreshState(sessionId);
}
