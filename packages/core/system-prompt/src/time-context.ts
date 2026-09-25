/**
 * Time-context refresh helper (DSH time-context refreshIntervalMs subset).
 * Tracks last injection per session so follow-up steps can re-stamp the clock
 * without rewriting the opening user turn on every tool round-trip.
 */

const lastInjectMs = new Map<string, number>();

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
    lastInjectMs.set(id, nowMs);
    return true;
  }
  return false;
}

/** Test / Host teardown hook. */
export function clearTimeContextRefreshState(): void {
  lastInjectMs.clear();
}

/** Record that time was injected (opening step volatile stamp). */
export function noteTimeContextInjected(
  sessionId: string,
  nowMs: number,
): void {
  lastInjectMs.set(sessionId.trim() || "_", nowMs);
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
