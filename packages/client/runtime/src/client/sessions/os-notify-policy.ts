/**
 * Product Settings (`desktop.notify*`) feed for session-completion OS notices.
 * Defaults match Face `desktop` base: on + unfocused-only.
 */

import type { NotifyFocusPolicy } from './os-notify.ts'

export type OsNotifyPolicy = {
  readonly enabled: boolean
  readonly focusPolicy: NotifyFocusPolicy
}

let policy: OsNotifyPolicy = {
  enabled: true,
  focusPolicy: 'unfocused',
}

/** Apply Face `desktop` notify fields (or General Desktop card). */
export function setOsNotifyPolicy(next: OsNotifyPolicy): void {
  policy = {
    enabled: next.enabled,
    focusPolicy: next.focusPolicy === 'always' ? 'always' : 'unfocused',
  }
}

export function getOsNotifyPolicy(): OsNotifyPolicy {
  return policy
}
