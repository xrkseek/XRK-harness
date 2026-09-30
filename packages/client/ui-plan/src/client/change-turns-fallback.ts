/**
 * Conversation-timeline harvest of embedded `workspace/changes` for Overview
 * when Face `workspaceChanges` is empty. Snapshot identity is stable across
 * unchanged content so `useSyncExternalStore` does not thrash.
 */
import type { OverviewChangesTurn } from './OverviewChangesPanel.tsx'

const EMPTY: readonly OverviewChangesTurn[] = []

type CacheRow = {
  readonly key: string
  readonly turns: readonly OverviewChangesTurn[]
}

const bySession = new Map<string, CacheRow>()

function fingerprint(turns: readonly OverviewChangesTurn[]): string {
  if (turns.length === 0) return ''
  return turns
    .map((row) => `${row.seq}:${row.turnId}:${row.total}:${row.added}:${row.deleted}:${row.files.length}`)
    .join('|')
}

type TimelineLike = {
  readonly turnOrder: readonly number[]
  readonly turns: ReadonlyMap<
    number,
    {
      readonly data: {
        get(key: string): { changes?: OverviewChangesTurn & { readonly cwd?: string } } | undefined
      }
    }
  >
}

/** Fold deliverables.changes rows from a chat timeline into Overview turns. */
export function harvestChangeTurns(timeline: TimelineLike): readonly OverviewChangesTurn[] {
  const out: OverviewChangesTurn[] = []
  for (const turnNum of timeline.turnOrder) {
    const changes = timeline.turns.get(turnNum)?.data.get('deliverables')?.changes
    if (changes === undefined || changes.files.length === 0) continue
    out.push({
      seq: changes.seq,
      turnId: changes.turnId,
      files: changes.files,
      total: changes.total,
      added: changes.added,
      deleted: changes.deleted,
    })
  }
  return out
}

/**
 * Stable getSnapshot for one Session. Returns the previous array reference when
 * the fingerprint is unchanged (required by useSyncExternalStore).
 */
export function changeTurnsFallbackSnapshot(
  sessionId: string,
  timeline: TimelineLike | undefined,
): readonly OverviewChangesTurn[] {
  if (timeline === undefined) {
    bySession.delete(sessionId)
    return EMPTY
  }
  const next = harvestChangeTurns(timeline)
  const key = fingerprint(next)
  const prev = bySession.get(sessionId)
  if (prev !== undefined && prev.key === key) return prev.turns
  const turns = next.length === 0 ? EMPTY : next
  bySession.set(sessionId, { key, turns })
  return turns
}
