// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import type { SessionId, SessionListState } from '@xrkseek/client-runtime/client'
import {
  nextSubagentCycleTarget,
  subagentCycleTargets,
  teamRootId,
} from '../src/client/subagent-cycle.ts'

function sid(id: string): SessionId {
  return id as SessionId
}

function state(partial: {
  current?: SessionId
  byId: SessionListState['byId']
  subagentsByParent?: SessionListState['subagentsByParent']
}): Pick<SessionListState, 'byId' | 'subagentsByParent' | 'current'> {
  return {
    byId: partial.byId,
    current: partial.current,
    subagentsByParent: partial.subagentsByParent ?? {},
  }
}

describe('subagent-cycle', () => {
  it('walks parentId to the team root', () => {
    const root = sid('root')
    const child = sid('child')
    const grand = sid('grand')
    const byId = {
      [root]: { id: root, displayTitle: 'r', running: false, blank: false, updatedAt: 1 },
      [child]: { id: child, displayTitle: 'c', running: false, blank: false, updatedAt: 1, parentId: root },
      [grand]: { id: grand, displayTitle: 'g', running: false, blank: false, updatedAt: 1, parentId: child },
    } as SessionListState['byId']
    expect(teamRootId({ byId }, grand)).toBe(root)
  })

  it('returns a singleton when there are no siblings (do not swallow keys)', () => {
    const root = sid('root')
    const snap = state({
      current: root,
      byId: {
        [root]: { id: root, displayTitle: 'r', running: false, blank: false, updatedAt: 1 },
      } as SessionListState['byId'],
    })
    expect(subagentCycleTargets(snap)).toHaveLength(1)
    expect(nextSubagentCycleTarget(snap, 1)).toBeUndefined()
  })

  it('cycles root → catalog children → back', () => {
    const root = sid('root')
    const a = sid('a')
    const b = sid('b')
    const snap = state({
      current: root,
      byId: {
        [root]: { id: root, displayTitle: 'r', running: false, blank: false, updatedAt: 1 },
        [a]: { id: a, displayTitle: 'a', running: false, blank: false, updatedAt: 1, parentId: root },
        [b]: { id: b, displayTitle: 'b', running: false, blank: false, updatedAt: 1, parentId: root },
      } as SessionListState['byId'],
      subagentsByParent: {
        [root]: {
          parentAvailable: true,
          state: 'ready',
          error: null,
          entries: [
            { kind: 'child', id: a, activity: 'inactive', hasChildren: false, mode: 'continuable', label: 'A' },
            { kind: 'child', id: b, activity: 'inactive', hasChildren: false, mode: 'one-shot' },
          ],
        },
      } as SessionListState['subagentsByParent'],
    })
    expect(subagentCycleTargets(snap)).toHaveLength(3)
    const next = nextSubagentCycleTarget(snap, 1)
    expect(next).toEqual({
      kind: 'subagent',
      address: { parentSessionId: root, childSessionId: a, mode: 'continuable' },
    })
    const fromA = state({ ...snap, current: a })
    expect(nextSubagentCycleTarget(fromA, 1)).toEqual({
      kind: 'subagent',
      address: { parentSessionId: root, childSessionId: b, mode: 'one-shot' },
    })
    const fromB = state({ ...snap, current: b })
    expect(nextSubagentCycleTarget(fromB, 1)).toEqual({ kind: 'session', id: root })
    expect(nextSubagentCycleTarget(fromB, -1)).toEqual({
      kind: 'subagent',
      address: { parentSessionId: root, childSessionId: a, mode: 'continuable' },
    })
  })
})
