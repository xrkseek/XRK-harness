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

  it('ignores assistant stream time jumps so the snapshot reference stays stable', () => {
    const base = [
      { kind: 'user', time: 100 },
      { kind: 'assistant', time: 200 },
    ]
    const first = presenceSessionCuesSnapshot('s5', base, 250)
    const streamed = [
      { kind: 'user', time: 100 },
      { kind: 'assistant', time: 280 },
    ]
    const second = presenceSessionCuesSnapshot('s5', streamed, 290)
    expect(second).toBe(first)
    expect(first.activityAt).toBe(100)
  })

  it('still updates when a tool-result error lands during the stream', () => {
    const streaming = [
      { kind: 'user', time: 100 },
      { kind: 'assistant', time: 200 },
    ]
    const first = presenceSessionCuesSnapshot('s6', streaming, 210)
    const withError = [
      { kind: 'user', time: 100 },
      { kind: 'assistant', time: 220 },
      { kind: 'tool-result', time: 230, isError: true, call: { name: 'bash' } },
    ]
    const second = presenceSessionCuesSnapshot('s6', withError, 240)
    expect(second).not.toBe(first)
    expect(second.toolError).toEqual({ name: 'bash' })
    expect(second.activityAt).toBe(230)
  })
})
