/**
 * Overview / PresenceDock soft-poll cadence for Face `session.status`.
 * Idle sessions stay quiet; slow Host replies stretch the next tick.
 */

const STATUS_POLL_IDLE_MS = 5_000
const STATUS_POLL_BUSY_MS = 1_200
const STATUS_POLL_IDLE_MAX_MS = 15_000
const STATUS_POLL_BUSY_MAX_MS = 8_000
/** Latency above this stretches the next soft-poll (Host was expensive). */
const STATUS_POLL_SLOW_MS = 400

/**
 * Next soft-poll delay from last Face latency and fleet busyness.
 * Finished heavy sessions must not hammer `session.status` every 2.5s.
 */
export function overviewStatusPollMs(fleetBusy: boolean, lastLatencyMs: number): number {
  const base = fleetBusy ? STATUS_POLL_BUSY_MS : STATUS_POLL_IDLE_MS
  const cap = fleetBusy ? STATUS_POLL_BUSY_MAX_MS : STATUS_POLL_IDLE_MAX_MS
  if (!(lastLatencyMs > STATUS_POLL_SLOW_MS)) return base
  return Math.min(Math.max(lastLatencyMs * 2, base), cap)
}
