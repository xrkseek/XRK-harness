/**
 * Cordis-free harvest + identity-stable cache for Overview / deliverables
 * `workspace/changes` turn cards. Shared so ui-plan and ui-deliverables do not
 * fork fingerprint logic (useSyncExternalStore thrash).
 */
import { createSessionSnapshotCache } from './stable-session-snapshot.ts'

export type WorkspaceChangesFileRow = {
  readonly path: string
  readonly display: string
  readonly added: number
  readonly deleted: number
  readonly binary?: true
  readonly oversized?: true
}

export type WorkspaceChangesTurnRow = {
  readonly seq: number
  readonly turnId: string
  readonly files: readonly WorkspaceChangesFileRow[]
  readonly total: number
  readonly added: number
  readonly deleted: number
  /** Present on timeline deliverables rows; Overview ignores it. */
  readonly cwd?: string
}

export const EMPTY_WORKSPACE_CHANGES_TURNS: readonly WorkspaceChangesTurnRow[] = []

const cache = createSessionSnapshotCache(EMPTY_WORKSPACE_CHANGES_TURNS)

export function fingerprintWorkspaceChangesTurns(
  turns: readonly WorkspaceChangesTurnRow[],
): string {
  if (turns.length === 0) return ''
  return turns
    .map((row) => `${row.seq}:${row.turnId}:${row.total}:${row.added}:${row.deleted}:${row.files.length}`)
    .join('|')
}

export type WorkspaceChangesTimelineLike = {
  readonly turnOrder: readonly number[]
  readonly turns: ReadonlyMap<
    number,
    {
      readonly data: {
        get(key: string): { changes?: WorkspaceChangesTurnRow } | undefined
      }
    }
  >
}

/** Fold deliverables.changes rows from a chat timeline into Overview turns. */
export function harvestWorkspaceChangesTurns(
  timeline: WorkspaceChangesTimelineLike,
): readonly WorkspaceChangesTurnRow[] {
  const out: WorkspaceChangesTurnRow[] = []
  for (const turnNum of timeline.turnOrder) {
    const changes = timeline.turns.get(turnNum)?.data.get('deliverables')?.changes
    if (changes === undefined || changes.files.length === 0) continue
    out.push(changes)
  }
  return out
}

/**
 * Return a cached array reference when the fingerprint is unchanged.
 * Required for any value fed into `useSyncExternalStore` getSnapshot.
 */
export function stableWorkspaceChangesTurns(
  sessionId: string,
  turns: readonly WorkspaceChangesTurnRow[],
): readonly WorkspaceChangesTurnRow[] {
  return cache.get(
    sessionId,
    fingerprintWorkspaceChangesTurns(turns),
    () => (turns.length === 0 ? EMPTY_WORKSPACE_CHANGES_TURNS : turns),
  )
}

/** Stable getSnapshot for one Session timeline (Face projection empty path). */
export function stableWorkspaceChangesTurnsFromTimeline(
  sessionId: string,
  timeline: WorkspaceChangesTimelineLike | undefined,
): readonly WorkspaceChangesTurnRow[] {
  if (timeline === undefined) {
    cache.clear(sessionId)
    return EMPTY_WORKSPACE_CHANGES_TURNS
  }
  return stableWorkspaceChangesTurns(sessionId, harvestWorkspaceChangesTurns(timeline))
}

/** Test-only: drop per-session cache rows. */
export function resetWorkspaceChangesTurnsCacheForTests(): void {
  cache.clear()
}
