import type { ProjectionSnapshot } from "@xrkseek/session-projection";

/** DSH sidebar list — title + blank bit only (no contextTimeline). */
export const SESSION_LIST_PROJECTION_KEYS = [
  "title",
  "sessionListMetadata",
] as const;

/**
 * History tail baseline: stats + composer meter (DSH StatsLine / ContextMeter).
 * Exclude contextTimeline + contextHeaders (Codex-style: heavy keys on demand).
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

export function snapshotWireBlock(
  snap: ProjectionSnapshot,
): { readonly asOfSeq: number; readonly values: ProjectionSnapshot["values"] } {
  return { asOfSeq: snap.asOfSeq, values: snap.values };
}
