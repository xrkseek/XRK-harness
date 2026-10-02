/**
 * Publish-on-notify soft faces: getSnapshot is referentially stable across
 * session notifies that do not change harvested content; publish never throws.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@xrkseek/client-runtime/client'
import { resetWorkspaceChangesTurnsCacheForTests } from '@xrkseek/client-ui-primitives'
import {
  createOverviewSessionSoftFaces,
  type OverviewSessionBinding,
} from '../src/client/overview-session-faces.ts'
import {
  resetPresenceSessionCuesCacheForTests,
  type PresenceTimelineNode,
} from '../src/client/presence-session-cues.ts'

const SID = 'sess_soft_faces' as SessionId

afterEach(() => {
  resetPresenceSessionCuesCacheForTests()
  resetWorkspaceChangesTurnsCacheForTests()
  vi.useRealTimers()
})

function makeBinding(input: {
  readonly nodes?: readonly PresenceTimelineNode[]
  readonly throwOnGet?: boolean
}): {
  binding: OverviewSessionBinding
  notify: () => void
} {
  const listeners = new Set<() => void>()
  const nodes = input.nodes ?? []
  const binding: OverviewSessionBinding = {
    session: {
      getSnapshot: () => {
        if (input.throwOnGet) throw new Error('snapshot boom')
        return {
          nodes,
          chat: {
            timeline: { turnOrder: [], turns: new Map() },
          },
        }
      },
      subscribe: (listener) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
    },
  }
  return {
    binding,
    notify: () => { for (const listener of listeners) listener() },
  }
}

describe('createOverviewSessionSoftFaces', () => {
  it('getSnapshot stays the same reference across notifies with unchanged content', () => {
    const { binding, notify } = makeBinding({
      nodes: [
        { kind: 'tool-result', time: 1_000, isError: false },
        { kind: 'user', time: 2_000 },
      ],
    })
    const faces = createOverviewSessionSoftFaces(SID, () => binding)
    const seen: unknown[] = []
    faces.presenceCues.subscribe(() => { seen.push(faces.presenceCues.getSnapshot()) })
    const first = faces.presenceCues.getSnapshot()
    notify()
    notify()
    expect(faces.presenceCues.getSnapshot()).toBe(first)
    expect(seen).toEqual([])
  })

  it('notifies when activityAt advances', () => {
    let nodes: readonly PresenceTimelineNode[] = [{ kind: 'user', time: 1_000 }]
    const listeners = new Set<() => void>()
    const binding: OverviewSessionBinding = {
      session: {
        getSnapshot: () => ({
          nodes,
          chat: { timeline: { turnOrder: [], turns: new Map() } },
        }),
        subscribe: (listener) => {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
      },
    }
    const faces = createOverviewSessionSoftFaces(SID, () => binding)
    let ticks = 0
    faces.presenceCues.subscribe(() => { ticks += 1 })
    const first = faces.presenceCues.getSnapshot()
    nodes = [{ kind: 'user', time: 1_000 }, { kind: 'user', time: 9_000 }]
    for (const listener of listeners) listener()
    expect(faces.presenceCues.getSnapshot()).not.toBe(first)
    expect(faces.presenceCues.getSnapshot().activityAt).toBe(9_000)
    expect(ticks).toBe(1)
  })

  it('swallow getSnapshot throws and keep EMPTY published', () => {
    const { binding, notify } = makeBinding({ throwOnGet: true })
    const faces = createOverviewSessionSoftFaces(SID, () => binding)
    faces.presenceCues.subscribe(() => {})
    faces.changeTurnsFallback.subscribe(() => {})
    expect(() => notify()).not.toThrow()
    expect(faces.presenceCues.getSnapshot().activityAt).toBe(0)
    expect(faces.changeTurnsFallback.getSnapshot()).toEqual([])
  })
})
