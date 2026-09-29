import { describe, expect, it } from 'vitest'
import {
  connectionChromeBusy,
  connectionChromePhaseKey,
} from '../src/client/connection-chrome.ts'

describe('connectionChrome', () => {
  it('stays busy through wire handshake and first session list', () => {
    expect(connectionChromeBusy({
      connectionState: undefined,
      connectionPhase: 'handshake:describe',
      sessionsPhase: 'pending',
      showRecovery: false,
    })).toBe(true)
    expect(connectionChromePhaseKey({
      connectionState: undefined,
      connectionPhase: 'handshake:describe',
      sessionsPhase: 'pending',
      showRecovery: false,
    })).toBe('connection.phase.describe')

    expect(connectionChromeBusy({
      connectionState: 'connected',
      connectionPhase: undefined,
      sessionsPhase: 'pending',
      showRecovery: false,
    })).toBe(true)
    expect(connectionChromePhaseKey({
      connectionState: 'connected',
      connectionPhase: undefined,
      sessionsPhase: 'pending',
      showRecovery: false,
    })).toBe('connection.phase.sessions')
  })

  it('clears when list is ready and wire is connected', () => {
    expect(connectionChromeBusy({
      connectionState: 'connected',
      connectionPhase: undefined,
      sessionsPhase: 'ready',
      showRecovery: false,
    })).toBe(false)
    expect(connectionChromePhaseKey({
      connectionState: 'connected',
      connectionPhase: undefined,
      sessionsPhase: 'ready',
      showRecovery: false,
    })).toBeUndefined()
  })
})
