// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest'
import {
  EMPTY_PRESENCE_SESSION_CUES,
  presenceSessionCuesSnapshot,
  resetPresenceSessionCuesCacheForTests,
} from '../src/client/presence-session-cues.ts'

describe('presenceSessionCuesSnapshot', () => {
  beforeEach(() => {
    resetPresenceSessionCuesCacheForTests()
  })

  it('returns the shared empty reference for missing or empty nodes', () => {
    const a = presenceSessionCuesSnapshot('s1', undefined, 1_000)
    const b = presenceSessionCuesSnapshot('s1', [], 1_000)
    expect(a).toBe(EMPTY_PRESENCE_SESSION_CUES)
    expect(b).toBe(EMPTY_PRESENCE_SESSION_CUES)
  })

  it('returns the same object when the fingerprint is unchanged', () => {
    const nodes = [
      { kind: 'user', time: 100 },
      { kind: 'tool-result', time: 200, isError: true, call: { name: 'bash' } },
    ]
    const first = presenceSessionCuesSnapshot('s2', nodes, 250)
    const second = presenceSessionCuesSnapshot('s2', nodes, 250)
    expect(first).toBe(second)
    expect(first.toolError).toEqual({ name: 'bash' })
    expect(first.activityAt).toBe(200)
  })

  it('keeps a stable fingerprint when the error node has no wall time', () => {
    const nodes = [
      { kind: 'tool-result', isError: true, call: { name: 'bash' } },
    ]
    const first = presenceSessionCuesSnapshot('s3', nodes, 1_000)
    const second = presenceSessionCuesSnapshot('s3', nodes, 2_000)
    expect(first).toBe(second)
    expect(first.toolError).toEqual({ name: 'bash' })
    expect(first.activityAt).toBe(0)
  })

  it('reuses one nameless toolError object across getSnapshot calls', () => {
    const nodes = [{ kind: 'tool-result', time: 10, isError: true }]
    const first = presenceSessionCuesSnapshot('s4', nodes, 20)
    const second = presenceSessionCuesSnapshot('s4', nodes, 30)
    expect(first).toBe(second)
    expect(first.toolError).toBe(second.toolError)
  })
})
