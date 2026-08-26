import type { ProjectionSnapshot } from "@xrkseek/session-projection";

/** DSH sidebar list — title + blank bit only (no contextTimeline). */
export const SESSION_LIST_PROJECTION_KEYS = [
  "title",
  "sessionListMetadata",
] as const;

/**
 * History tail baseline: stats + composer meter (DSH StatsLine / ContextMeter).
 * Heavy dsh-context keys ride the tail page only — see
 * {@link sessionHistoryProjectionKeys}.
 */
export const SESSION_HISTORY_PROJECTION_KEYS = [
  "title",
  "sessionListMetadata",
  "todos",
  "permissions",
  "plan",
  "sessionStats",
  "tokenUsage",
  "costUsage",
  "contextPressure",
  "contextBreakdown",
  "autoReview",
  "imageLimits",
] as const;

/**
 * dsh-context tab (`useProjection('contextTimeline'|'contextHeaders')`).
 * Folded on the history tail page only — not list rows, not loadOlder pages.
 */
export const SESSION_CONTEXT_PROJECTION_KEYS = [
  "contextTimeline",
  "contextHeaders",
] as const;

/** Projection keys for one `session.history` response. */
export function sessionHistoryProjectionKeys(
  beforeSeq?: number,
): readonly string[] {
  if (beforeSeq !== undefined) return SESSION_HISTORY_PROJECTION_KEYS;
  return [...SESSION_HISTORY_PROJECTION_KEYS, ...SESSION_CONTEXT_PROJECTION_KEYS];
}

export function snapshotWireBlock(
  snap: ProjectionSnapshot,
): { readonly asOfSeq: number; readonly values: ProjectionSnapshot["values"] } {
  return { asOfSeq: snap.asOfSeq, values: snap.values };
}
