/** Conversation UI preferences stored in the Host user-settings document. */

import z from '@xrkseek/schemastery'

/** Settings namespace owned by the conversation plugin. */
export const CONVERSATION_SETTINGS_NAMESPACE = 'ui-conversation'

/** Field carrying the delivery mode for plain Enter while an agent is busy. */
export const BUSY_ENTER_FIELD = 'busyEnter'

/** Field: chat tool rows start expanded when true. */
export const TOOLS_DEFAULT_EXPANDED_FIELD = 'toolsDefaultExpanded'

/** Busy-Enter behaviors accepted at settings and input boundaries. */
export const BUSY_ENTER_BEHAVIORS = ['queue', 'steer'] as const

/** Configurable meaning of plain Enter while the addressed agent is busy. */
export type BusyEnterBehavior = typeof BUSY_ENTER_BEHAVIORS[number]

/** Default preserves Enter-as-Queue for running conversations. */
export const DEFAULT_BUSY_ENTER_BEHAVIOR: BusyEnterBehavior = 'queue'

/** Default keeps tool rows collapsed (DSH / Codex quiet transcript posture). */
export const DEFAULT_TOOLS_DEFAULT_EXPANDED = false

/** Durable conversation section shared by the Host schema and the browser scope. */
export interface ConversationSettings {
  /** Delivery mode for plain Enter while the addressed agent is busy. */
  busyEnter: BusyEnterBehavior
  /** When true, ToolRow / Bash rows mount expanded. */
  toolsDefaultExpanded: boolean
}

/** Durable conversation schema; also the wire envelope the browser scope validates against. */
export const ConversationSettingsSchema: z<ConversationSettings> = z.object({
  [BUSY_ENTER_FIELD]: z.union([...BUSY_ENTER_BEHAVIORS]).default(DEFAULT_BUSY_ENTER_BEHAVIOR),
  [TOOLS_DEFAULT_EXPANDED_FIELD]: z.boolean().default(DEFAULT_TOOLS_DEFAULT_EXPANDED),
})
