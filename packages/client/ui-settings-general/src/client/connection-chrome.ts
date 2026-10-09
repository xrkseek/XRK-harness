/**
 * Map wire + session-list boot facts onto Settings connection phase copy keys.
 * Shared by Web and Desktop (same SettingsRoot chrome).
 */
import type {
  ConnectionPhase,
  ConnectionState,
} from '@xrkseek/client-connection/client'
import type { SettingsKey } from './locales.ts'

/** Coarse facts SettingsRoot needs to pick a spinner label. */
export type ConnectionChromeFacts = {
  readonly connectionState: ConnectionState | undefined
  readonly connectionPhase: ConnectionPhase | undefined
  readonly sessionsPhase: 'pending' | 'ready'
  readonly showRecovery: boolean
}

/** Host gate hard-fail: show outage chrome (click reconnect), not a spinner. */
export function connectionChromeHalted(facts: ConnectionChromeFacts): boolean {
  return !facts.showRecovery && facts.connectionPhase === 'retry:halted'
}

/** Whether the footer spinner should stay up (handshake or first list pull). */
export function connectionChromeBusy(facts: ConnectionChromeFacts): boolean {
  if (facts.showRecovery) return false
  if (connectionChromeHalted(facts)) return false
  if (facts.connectionState === undefined) return true
  if (facts.connectionState === 'reconnecting') return true
  return facts.connectionState === 'connected' && facts.sessionsPhase !== 'ready'
}

/** Locale key for the visible connecting label (or undefined when idle/recovered). */
export function connectionChromePhaseKey(
  facts: ConnectionChromeFacts,
): SettingsKey | undefined {
  if (facts.showRecovery) return undefined
  if (connectionChromeHalted(facts)) return undefined
  if (facts.connectionState === 'connected' && facts.sessionsPhase !== 'ready') {
    return 'connection.phase.sessions'
  }
  if (!connectionChromeBusy(facts)) return undefined
  switch (facts.connectionPhase) {
    case 'handshake:host':
      return 'connection.phase.host'
    case 'handshake:describe':
      return 'connection.phase.describe'
    case 'handshake:streams':
      return 'connection.phase.streams'
    case 'retry:backoff':
      return 'connection.phase.backoff'
    default:
      return 'connection.phase.initial'
  }
}
