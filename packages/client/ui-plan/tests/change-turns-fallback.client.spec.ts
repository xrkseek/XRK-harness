// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest'
import {
  changeTurnsFallbackSnapshot,
  harvestChangeTurns,
  resetWorkspaceChangesTurnsCacheForTests,
} from '../src/client/change-turns-fallback.ts'

describe('changeTurnsFallbackSnapshot', () => {
  beforeEach(() => {
    resetWorkspaceChangesTurnsCacheForTests()
  })

  it('returns a stable empty reference when the timeline has no changes', () => {
    const timeline = { turnOrder: [1] as const, turns: new Map() }
    const a = changeTurnsFallbackSnapshot('s1', timeline)
    const b = changeTurnsFallbackSnapshot('s1', timeline)
    expect(a).toBe(b)
    expect(a).toEqual([])
  })

  it('reuses the same array when the fingerprint is unchanged', () => {
    const changes = {
      seq: 4,
      turnId: 't1',
      files: [{ path: 'a.ts', display: 'a.ts', added: 1, deleted: 0 }],
      total: 1,
      added: 1,
      deleted: 0,
    }
    const turn = {
      data: {
        get(key: string) {
          return key === 'deliverables' ? { changes } : undefined
        },
      },
    }
    const timeline = {
      turnOrder: [1],
      turns: new Map([[1, turn]]),
    }
    const a = changeTurnsFallbackSnapshot('s2', timeline)
    const b = changeTurnsFallbackSnapshot('s2', timeline)
    expect(a).toBe(b)
    expect(a).toEqual([changes])
    expect(harvestChangeTurns(timeline)).toEqual([changes])
  })

  it('allocates a new array when seq changes', () => {
    const make = (seq: number) => ({
      turnOrder: [1],
      turns: new Map([
        [
          1,
          {
            data: {
              get(key: string) {
                return key === 'deliverables'
                  ? {
                    changes: {
                      seq,
                      turnId: 't1',
                      files: [{ path: 'a.ts', display: 'a.ts', added: 1, deleted: 0 }],
                      total: 1,
                      added: 1,
                      deleted: 0,
                    },
                  }
                  : undefined
              },
            },
          },
        ],
      ]),
    })
    const first = changeTurnsFallbackSnapshot('s3', make(4))
    const second = changeTurnsFallbackSnapshot('s3', make(5))
    expect(first).not.toBe(second)
    expect(first[0]?.seq).toBe(4)
    expect(second[0]?.seq).toBe(5)
  })
})
