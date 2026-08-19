/**
 * Type-only allowlist seat. The Host event names live in Face; this file only
 * keeps `import type {} from '@xrkseek/xrk-api-remotes/types'` compiling
 * and fills `$on`'s selection keys.
 */
import type { SessionId } from '@xrkseek/xrk-session/types'
import type { Branded } from '@xrkseek/xrk-brand'

export type ApiRemoteForwardedEvent =
  | 'agent-preset/selected'
  | 'commands/change'
  | 'credentials/updated'
  | 'cordis/request-run'
  | 'cordis/request-run-resolved'
  | 'cordis/dynamic-package'
  | 'cordis/dynamic-retract'
  | 'cordis/inspect-query'
  | 'cordis/inspect-query-resolved'
  | 'llm/adapters-updated'
  | 'settings/document-updated'

declare module '@xrkseek/xrk-typert-protocol' {
  interface TypertRemoteEventSelection extends Record<ApiRemoteForwardedEvent, true> {}
}

/** Events whose owner packages are not in this workspace; declared here so `$on` keys resolve. */
declare module '@xrkseek/cordis' {
  interface Events {
    'credentials/updated'(ref: Branded<'CredentialRef'>): void
    'agent-preset/selected'(sessionId: SessionId, agentPreset: string): void
  }
}
