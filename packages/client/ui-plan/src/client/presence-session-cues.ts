/**
 * Session cues that drive Overview presence without Face sticky —
 * recent tool failures and idle quiet duration.
 *
 * Snapshot identity is stable across unchanged content so
 * `useSyncExternalStore` does not thrash (same habit as change-turns-fallback).
 */

export const PRESENCE_TOOL_ERROR_MS = 45_000
export const PRESENCE_STANDBY_MS = 45_000
export const PRESENCE_SLEEP_MS = 120_000

export type PresenceSessionCues = {
  readonly toolError?: { readonly name?: string }
  readonly activityAt: number
}

/** Shared empty snapshot — never allocate per getSnapshot call. */
export const EMPTY_PRESENCE_SESSION_CUES: PresenceSessionCues = { activityAt: 0 }

/** Minimal node shape from ConversationSnapshot.nodes (tool-result arm). */
export type PresenceTimelineNode = {
  readonly kind: string
  readonly time?: number
  readonly isError?: boolean
  readonly call?: { readonly name: string } | null
}

/**
 * Most recent in-window tool failure (newest-first scan).
 * Returns undefined when none, or when the latest error is older than the window.
 */
export function latestToolErrorCue(
  nodes: readonly PresenceTimelineNode[],
  nowMs: number,
  windowMs = PRESENCE_TOOL_ERROR_MS,
): { readonly at: number; readonly name?: string } | undefined {
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i]
    if (node === undefined || node.kind !== 'tool-result') continue
    if (node.isError !== true) continue
    const at = typeof node.time === 'number' && Number.isFinite(node.time) ? node.time : 0
    if (at > 0 && nowMs - at > windowMs) return undefined
    return {
      at: at > 0 ? at : nowMs,
      ...(node.call?.name ? { name: node.call.name } : {}),
    }
  }
  return undefined
}

/** Newest node wall time (any kind with `time`) — seeds idle when Overview opens mid-session. */
export function latestNodeActivityAt(nodes: readonly PresenceTimelineNode[]): number {
  let latest = 0
  for (const node of nodes) {
    const at = typeof node.time === 'number' && Number.isFinite(node.time) ? node.time : 0
    if (at > latest) latest = at
  }
  return latest
}

type PresenceCueCache = {
  readonly key: string
  readonly snapshot: PresenceSessionCues
}

const cueBySession = new Map<string, PresenceCueCache>()

/**
 * Stable presence cues for `useSyncExternalStore` — fingerprint avoids thrash.
 * Always returns a cached / shared object reference when content is unchanged.
 */
export function presenceSessionCuesSnapshot(
  sessionId: string,
  nodes: readonly PresenceTimelineNode[] | undefined,
  nowMs: number,
): PresenceSessionCues {
  if (nodes === undefined || nodes.length === 0) {
    cueBySession.delete(sessionId)
    return EMPTY_PRESENCE_SESSION_CUES
  }
  const err = latestToolErrorCue(nodes, nowMs)
  const activityAt = latestNodeActivityAt(nodes)
  const key = `${err?.at ?? 0}:${err?.name ?? ''}:${activityAt}:${nodes.length}`
  const prev = cueBySession.get(sessionId)
  if (prev !== undefined && prev.key === key) return prev.snapshot
  const toolError = err
    ? (err.name ? { name: err.name } : {})
    : undefined
  const snapshot: PresenceSessionCues = {
    activityAt,
    ...(toolError ? { toolError } : {}),
  }
  cueBySession.set(sessionId, { key, snapshot })
  return snapshot
}
