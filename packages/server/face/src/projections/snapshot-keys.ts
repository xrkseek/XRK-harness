import type { ProjectionSnapshot } from "@xrkseek/session-projection";

/**
 * Codex-style projection tiers for Face session RPC (single source of truth):
 *
 * | Carrier | When | Fold budget |
 * |---------|------|-------------|
 * | `session.list` | loaded | {@link SESSION_LIST_PROJECTION_KEYS} live fold |
 * | `session.list` | cold | list-checkpoint cache · else hints-only |
 * | `session.history` tail | `beforeSeq` absent | light + {@link SESSION_CONTEXT_PROJECTION_KEYS} |
 * | `session.history` older | `beforeSeq` set | **none** — no `projections` block |
 * | mux | live events | `session/projection` push frames |
 *
 * Cold list never loads the session log for projections (Codex / api-proxy posture).
 */

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
  "turnOutline",
  "tokenUsage",
  "costUsage",
  "contextPressure",
  "contextBreakdown",
  "autoReview",
  "imageLimits",
] as const;

/**
 * dsh-context tab (`useProjection('contextTimeline'|'contextHeaders')`).
 * Folded on the history tail page only — not list rows, not loadOlder pages
 * (loadOlder responses omit the whole projections block; see sessionHistory).
 */
export const SESSION_CONTEXT_PROJECTION_KEYS = [
  "contextTimeline",
  "contextHeaders",
] as const;

/** Whether `session.history` should carry a projections block (tail page only). */
export function historyPageIncludesProjections(
  beforeSeq: number | undefined,
): boolean {
  return beforeSeq === undefined;
}

/** Projection keys for one `session.history` tail response. */
export function sessionHistoryTailProjectionKeys(): readonly string[] {
  return [...SESSION_HISTORY_PROJECTION_KEYS, ...SESSION_CONTEXT_PROJECTION_KEYS];
}

/**
 * @deprecated Prefer {@link historyPageIncludesProjections} + {@link sessionHistoryTailProjectionKeys}.
 * Kept for tests documenting loadOlder must not use heavy keys.
 */
export function sessionHistoryProjectionKeys(
  beforeSeq?: number,
): readonly string[] {
  if (beforeSeq !== undefined) return SESSION_HISTORY_PROJECTION_KEYS;
  return sessionHistoryTailProjectionKeys();
}

export function snapshotWireBlock(
  snap: ProjectionSnapshot,
): { readonly asOfSeq: number; readonly values: ProjectionSnapshot["values"] } {
  return { asOfSeq: snap.asOfSeq, values: snap.values };
}
