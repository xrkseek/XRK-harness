import { describe, expect, it } from 'vitest'
import { packRemoteArgs } from '../src/client/pack.ts'

describe('packRemoteArgs', () => {
  it('zips positional wires', () => {
    expect(packRemoteArgs(['agentId'], ['sess-1'])).toEqual({ agentId: 'sess-1' })
    expect(packRemoteArgs(['agentId', 'line'], ['sess-1', '/help'])).toEqual({
      agentId: 'sess-1',
      line: '/help',
    })
  })

  it('spreads a single args bag', () => {
    expect(packRemoteArgs('args', [{ sessionId: 's1', ifVersion: 2 }])).toEqual({
      sessionId: 's1',
      ifVersion: 2,
    })
  })

  it('drops a trailing AbortSignal', () => {
    const signal = new AbortController().signal
    expect(packRemoteArgs(['agentId', 'line'], ['s1', '/x', signal])).toEqual({
      agentId: 's1',
      line: '/x',
    })
  })

  it('returns an empty object for no-arg methods', () => {
    expect(packRemoteArgs([], [])).toEqual({})
  })
})
