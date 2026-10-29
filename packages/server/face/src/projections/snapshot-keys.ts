import type { ProjectionSnapshot } from "@xrkseek/session-projection";

/**
 * Codex-style projection tiers for Face session RPC (single source of truth):
 *
 * | Carrier | When | Fold budget |
 * |---------|------|-------------|
 * | `session.list` | loaded | {@link SESSION_LIST_PROJECTION_KEYS} live fold |
 * | `session.list` | cold | list-checkpoint cache · else hints-only (corrupt/partial parse → miss) |
 * | `session.history` tail | `beforeSeq` absent | light (incl. `workspaceChanges`) + {@link SESSION_CONTEXT_PROJECTION_KEYS} |
 * | `session.history` older | `beforeSeq` set | **none** — no `projections` block |
 * | mux | live events | `session/projection` push frames |
 *
 * Cold list never loads the session log for projections (Codex / api-proxy posture).
 */

/**
 * DSH sidebar list — title + blank bit only (no contextTimeline).
 * Prefer {@link sessionListProjectionKeys} at runtime: units declare
 * `wire.summary: true` and the registry owns the live set. This constant is
 * the documented bootstrap / disk-filter fallback and must stay equal to
 * `installDefaultFaceProjections` summary keys (enforced by test).
 */
export const SESSION_LIST_PROJECTION_KEYS = [
  "title",
  "sessionListMetadata",
] as const;

/** Live list-tier keys from `wire.summary: true` registrations. */
export function sessionListProjectionKeys(registry: {
  summaryKeys(): ReadonlySet<string>;
}): readonly string[] {
  return [...registry.summaryKeys()];
}

/**
 * History tail baseline: stats + composer meter (DSH StatsLine / ContextMeter).
 * Heavy dsh-context keys ride the tail page only — see
 * {@link sessionHistoryTailProjectionKeys}.
 */
export const SESSION_HISTORY_PROJECTION_KEYS = [
  "title",
  "sessionListMetadata",
  "todos",
  "permissions",
  "plan",
  "sessionStats",
  "turnOutline",
  "workspaceChanges",
  "tokenUsage",
  "costUsage",
  "contextPressure",
  "contextBreakdown",
  "autoReview",
  "imageLimits",
  "fileLimits",
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
 * Durable history-tier keys persisted beside the list cache (R9). Cold
 * `session.history` can {@link FaceListProjectionCache.peekHistoryCheckpoint}
 * + `viewCheckpoint` these without hydrating the log for a full fold.
 *
 * Excludes list-tier keys: eviction `rememberListProjections` only checkpoints
 * title/metadata — if those sat in this set, they would overwrite the heavy
 * history rows and erase turnOutline / contextTimeline on every resident drop.
 */
export const SESSION_HISTORY_CACHE_KEYS: readonly string[] =
  sessionHistoryTailProjectionKeys().filter(
    (key) =>
      !(SESSION_LIST_PROJECTION_KEYS as readonly string[]).includes(key),
  );

export function snapshotWireBlock(
  snap: ProjectionSnapshot,
): { readonly asOfSeq: number; readonly values: ProjectionSnapshot["values"] } {
  return { asOfSeq: snap.asOfSeq, values: snap.values };
}
