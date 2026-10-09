/**
 * Session cues that drive Overview presence without Face sticky —
 * recent tool failures and idle quiet duration.
 *
 * Snapshot identity is stable across unchanged content so
 * `useSyncExternalStore` does not thrash (same habit as workspace-changes-turns).
 */
import { createSessionSnapshotCache } from '@xrkseek/client-ui-primitives'

export const PRESENCE_TOOL_ERROR_MS = 45_000
export const PRESENCE_STANDBY_MS = 45_000
export const PRESENCE_SLEEP_MS = 120_000

export type PresenceSessionCues = {
  readonly toolError?: { readonly name?: string }
  readonly activityAt: number
}

/** Shared empty snapshot — never allocate per getSnapshot call. */
export const EMPTY_PRESENCE_SESSION_CUES: PresenceSessionCues = { activityAt: 0 }

/** Shared nameless tool-error marker — never allocate `{}` per getSnapshot. */
const TOOL_ERROR_UNNAMED: { readonly name?: string } = {}

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
    // Missing wall time stays in-window; never stamp `at` with nowMs — that
    // would thrash useSyncExternalStore fingerprints on every getSnapshot.
    if (at > 0 && nowMs - at > windowMs) return undefined
    return {
      at,
      ...(node.call?.name ? { name: node.call.name } : {}),
    }
  }
  return undefined
}

/**
 * Node kinds whose `time` updates on every stream token / reasoning chunk.
 * Including them in cues fingerprints re-renders PresenceDock on each chunk.
 * Idle / sleep still use `turnActive` + PHASE clock in PresenceBall — not token times.
 */
const STREAM_ACTIVITY_NOISE = new Set([
  'assistant',
  'assistant-step',
  'step',
])

/** Newest non-stream wall time — seeds idle without thrashing on token paint. */
export function latestNodeActivityAt(nodes: readonly PresenceTimelineNode[]): number {
  let latest = 0
  for (const node of nodes) {
    if (STREAM_ACTIVITY_NOISE.has(node.kind)) continue
    const at = typeof node.time === 'number' && Number.isFinite(node.time) ? node.time : 0
    if (at > latest) latest = at
  }
  return latest
}

const cueCache = createSessionSnapshotCache(EMPTY_PRESENCE_SESSION_CUES)

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
    cueCache.clear(sessionId)
    return EMPTY_PRESENCE_SESSION_CUES
  }
  const err = latestToolErrorCue(nodes, nowMs)
  const activityAt = latestNodeActivityAt(nodes)
  const key = `${err?.at ?? 0}:${err?.name ?? ''}:${activityAt}`
  return cueCache.get(sessionId, key, () => {
    const toolError = err
      ? (err.name ? { name: err.name } : TOOL_ERROR_UNNAMED)
      : undefined
    return {
      activityAt,
      ...(toolError ? { toolError } : {}),
    }
  })
}

/** Test-only reset. */
export function resetPresenceSessionCuesCacheForTests(): void {
  cueCache.clear()
}
