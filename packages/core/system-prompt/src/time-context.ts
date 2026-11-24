/**
 * Time-context refresh helper (DSH time-context refreshIntervalMs subset).
 * Tracks last injection per session so follow-up steps can re-stamp the clock
 * without rewriting the opening user turn on every tool round-trip.
 */

const lastInjectMs = new Map<string, number>();
/** Soft cap so Host long-runs do not retain every historical sessionId. */
const TIME_CONTEXT_CACHE_MAX = 64;

function rememberInject(id: string, nowMs: number): void {
  if (lastInjectMs.has(id)) lastInjectMs.delete(id);
  lastInjectMs.set(id, nowMs);
  while (lastInjectMs.size > TIME_CONTEXT_CACHE_MAX) {
    const oldest = lastInjectMs.keys().next().value;
    if (oldest === undefined) break;
    lastInjectMs.delete(oldest);
  }
}

/**
 * @param sessionId - session key
 * @param nowMs - wall clock
 * @param intervalMs - min ms between refreshes; `0` = every call; negative = never
 * @returns whether a new time reading should be injected
 */
export function shouldRefreshTimeContext(
  sessionId: string,
  nowMs: number,
  intervalMs: number,
): boolean {
  if (!Number.isFinite(intervalMs) || intervalMs < 0) return false;
  const id = sessionId.trim() || "_";
  const prev = lastInjectMs.get(id);
  if (prev === undefined || intervalMs === 0 || nowMs - prev >= intervalMs) {
    rememberInject(id, nowMs);
    return true;
  }
  return false;
}

/**
 * Drop last-inject stamp(s). Call on session delete / log cut, or from tests.
 * Omit `sessionId` to clear the whole table.
 */
export function clearTimeContextRefreshState(sessionId?: string): void {
  if (sessionId === undefined) {
    lastInjectMs.clear();
    return;
  }
  lastInjectMs.delete(sessionId.trim() || "_");
}

/** Record that time was injected (opening step volatile stamp). */
export function noteTimeContextInjected(
  sessionId: string,
  nowMs: number,
): void {
  rememberInject(sessionId.trim() || "_", nowMs);
}

/**
 * Parse `XRK_TIME_CONTEXT_REFRESH_MS` — unset defaults to 60_000 (one minute).
 * `0` = every eligible step; negative / `off` disables follow-up refresh.
 */
export function parseTimeContextRefreshMs(
  raw: string | undefined,
): number {
  if (raw === undefined) return 60_000;
  const t = raw.trim().toLowerCase();
  if (t === "" || t === "off" || t === "false") return -1;
  const n = Number(t);
  if (!Number.isFinite(n)) return 60_000;
  return Math.floor(n);
}
