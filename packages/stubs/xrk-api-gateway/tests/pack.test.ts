import { describe, expect, it } from 'vitest'
import { faceRemoteEndpoint, packRemoteArgs } from '../src/client/pack.ts'

describe('faceRemoteEndpoint', () => {
  it('uses dotted Face paths for session and slash paths for other remotes', () => {
    expect(faceRemoteEndpoint('session', 'list')).toBe('session.list')
    expect(faceRemoteEndpoint('session', 'selectModel')).toBe('session.selectModel')
    expect(faceRemoteEndpoint('commands', 'list')).toBe('commands/list')
    expect(faceRemoteEndpoint('pluginInventory', 'open')).toBe('pluginInventory/open')
  })

  it('aliases DSH session-controller names onto Face methods', () => {
    expect(faceRemoteEndpoint('session', 'modelCatalog')).toBe('session.models')
    expect(faceRemoteEndpoint('session', 'page')).toBe('session.history')
  })
})

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
