/** React bindings for the framework-neutral slot and snapshot contracts. */
import type { SnapshotSelectorHook } from '@xrkseek/client-ui-slots'

export { bindSnapshotSelector } from './bind.ts'

/**
 * Selector hook over a session's conversation snapshot. Wide (`object`) by
 * default inside this dependency-inverted package; runtime narrows it once at
 * its exports (`UseSession<ConversationSnapshot>`) — the snapshot type
 * never flows back into web-react.
 */
export type UseSession<Snap extends object = object> = SnapshotSelectorHook<Snap>

export type {
  ChainRenderOpts, HostObservable, RenderOpts, SessionProvideInfo, SnapshotSelectorHook,
  SlotRenderer, SlotRendererHost, StoreInstanceLike,
} from '@xrkseek/client-ui-slots'
export { SlotOwnershipError, StaleAuthorizationError } from '@xrkseek/client-ui-slots'
export { createSlotRenderer } from './scoped-slots.tsx'
export { makeDiag, shortError, slotDiag, type Diag, type DiagLevel, type DiagRecord } from './diag.ts'

export { SessionProvider, SlotAssemblyError, type SessionProviderProps } from './session-provider.tsx'

export { useInvoke } from './use-invoke.ts'
