// @vitest-environment node
import { describe, expect, it, beforeEach } from 'vitest'
import {
  EMPTY_WORKSPACE_CHANGES_TURNS,
  harvestWorkspaceChangesTurns,
  resetWorkspaceChangesTurnsCacheForTests,
  stableWorkspaceChangesTurns,
  stableWorkspaceChangesTurnsFromTimeline,
} from '../src/workspace-changes-turns.ts'
import { createSessionSnapshotCache } from '../src/stable-session-snapshot.ts'
import { diffHunkFromWorkspaceFileDiff } from '../src/workspace-file-diff-hunk.ts'

describe('createSessionSnapshotCache', () => {
  it('returns the shared empty value for an empty fingerprint', () => {
    const empty = Object.freeze({ n: 0 })
    const cache = createSessionSnapshotCache(empty)
    expect(cache.get('s1', '', () => ({ n: 1 }))).toBe(empty)
    expect(cache.get('s1', '', () => ({ n: 2 }))).toBe(empty)
  })

  it('reuses the built value while the fingerprint is unchanged', () => {
    const empty = Object.freeze({ n: 0 })
    const cache = createSessionSnapshotCache(empty)
    let builds = 0
    const a = cache.get('s1', 'k', () => {
      builds += 1
      return { n: builds }
    })
    const b = cache.get('s1', 'k', () => {
      builds += 1
      return { n: builds }
    })
    expect(a).toBe(b)
    expect(builds).toBe(1)
  })
})

describe('workspace-changes-turns', () => {
  beforeEach(() => {
    resetWorkspaceChangesTurnsCacheForTests()
  })

  it('returns the shared empty reference for an empty timeline', () => {
    const timeline = { turnOrder: [1] as const, turns: new Map() }
    const a = stableWorkspaceChangesTurnsFromTimeline('s1', timeline)
    const b = stableWorkspaceChangesTurnsFromTimeline('s1', timeline)
    expect(a).toBe(EMPTY_WORKSPACE_CHANGES_TURNS)
    expect(b).toBe(EMPTY_WORKSPACE_CHANGES_TURNS)
  })

  it('reuses the same array when the fingerprint is unchanged', () => {
    const changes = {
      seq: 4,
      turnId: 't1',
      cwd: '/w',
      files: [{ path: 'a.ts', display: 'a.ts', added: 1, deleted: 0 }],
      total: 1,
      added: 1,
      deleted: 0,
    }
    const timeline = {
      turnOrder: [1],
      turns: new Map([
        [1, { data: { get: (key: string) => (key === 'deliverables' ? { changes } : undefined) } }],
      ]),
    }
    const a = stableWorkspaceChangesTurnsFromTimeline('s2', timeline)
    const b = stableWorkspaceChangesTurnsFromTimeline('s2', timeline)
    expect(a).toBe(b)
    expect(a).toEqual([changes])
    expect(harvestWorkspaceChangesTurns(timeline)).toEqual([changes])
  })

  it('stabilizes Face projection arrays with the same fingerprint', () => {
    const row = {
      seq: 1,
      turnId: 't1',
      files: [{ path: 'a.ts', display: 'a.ts', added: 1, deleted: 0 }],
      total: 1,
      added: 1,
      deleted: 0,
    }
    const a = stableWorkspaceChangesTurns('s3', [row])
    const b = stableWorkspaceChangesTurns('s3', [{ ...row }])
    expect(a).toBe(b)
  })
})

describe('diffHunkFromWorkspaceFileDiff', () => {
  it('rebuilds DiffBlock texts from Face hunk lines', () => {
    const hunk = diffHunkFromWorkspaceFileDiff({
      kind: 'text',
      path: 'a.ts',
      before: true,
      after: true,
      hunks: [{ lines: [' context', '-old', '+new'] }],
    })
    expect(hunk).toEqual({
      path: 'a.ts',
      oldText: 'context\nold\n',
      newText: 'context\nnew\n',
    })
  })

  it('returns null for non-text kinds', () => {
    expect(diffHunkFromWorkspaceFileDiff({ kind: 'binary', path: 'a.bin' })).toBeNull()
  })
})
