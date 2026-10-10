import type {
  ConversationLocation,
  ConversationTimelineSnapshot,
} from '@xrkseek/client-runtime/client'

/**
 * Turn 回合: opener (earliest live-turn user row) sits above waiting.
 * Later user-shaped rows on that in-flight turn are 「插队中」 below waiting
 * until the turn ends — unless Host promoted the row and opened the next
 * step, which re-anchors the flow: that row is the next request's opener, so
 * waiting follows it. 排队 is the next 轮次 (QueueDock).
 *
 * The opener may precede Host `turn/start` (inject stamps the clock after
 * the first user message). Follow-ups are 插队 by identity, not by clock.
 */

/** Start time of the latest open turn, or null when the timeline has none. */
export function runningTurnStartTime(timeline: ConversationTimelineSnapshot): number | null {
  let latest: number | null = null
  for (const turn of timeline.turns.values()) {
    if (turn.status === 'open' && turn.start !== undefined) latest = turn.start.time
  }
  return latest
}

/** Whether the timeline currently has an open turn. */
export function hasOpenTurn(timeline: ConversationTimelineSnapshot): boolean {
  for (const turn of timeline.turns.values()) {
    if (turn.status === 'open') return true
  }
  return false
}

/** Whether every known turn has already closed (drain latch after settle). */
export function turnsAreSettled(timeline: ConversationTimelineSnapshot): boolean {
  if (timeline.turns.size === 0) return false
  return !hasOpenTurn(timeline)
}

/**
 * Waiting can appear on `running` before `turn/start` is in the timeline
 * (both user rows sit at session). After every known turn has closed,
 * running-lag must not keep follow-ups as 「插队中」.
 * `live` is Host `running` (same latch as Stop), not draining tools.
 */
export function isTurnInFlight(live: boolean, turnOpen: boolean, turnsSettled: boolean): boolean {
  if (!live) return false
  if (turnOpen) return true
  return !turnsSettled
}

function owningTurnClosed(location: ConversationLocation): boolean {
  return (location.kind === 'turn' || location.kind === 'step') && location.turn.status === 'closed'
}

/** Highest Turn number in the timeline, open or closed. */
export function latestTurnNumber(timeline: ConversationTimelineSnapshot): number | null {
  let latest: number | null = null
  for (const turn of timeline.turns.values()) {
    if (latest === null || turn.turn > latest) latest = turn.turn
  }
  return latest
}

/** Closed owning turns are prior 轮次. A new send after settle is the next opener. */
export function isHistoricClosedTurn(
  location: ConversationLocation,
  _latestTurn?: number | null,
): boolean {
  void _latestTurn
  return owningTurnClosed(location)
}

function isUserShaped(kind: string): boolean {
  return kind === 'user' || kind === 'steering'
}

function isAgentWorkRow(kind: string): boolean {
  return kind === 'assistant-step' || kind === 'tool-call'
}

type TimedChatRow = {
  readonly kind: string
  readonly location?: ConversationLocation
  readonly data?: {
    readonly seq?: number
    readonly time?: number
    readonly content?: readonly unknown[]
    readonly finalNode?: { readonly seq?: number }
  }
}

/** Visible assistant/tool rows on this flight: a later human is 插队, not a new opener. */
export function hasLiveAgentWork(
  nodes: Iterable<{ readonly kind: string; readonly location?: ConversationLocation }>,
  latestTurn?: number | null,
): boolean {
  for (const node of nodes) {
    if (!isAgentWorkRow(node.kind)) continue
    if (node.location !== undefined && isHistoricClosedTurn(node.location, latestTurn)) continue
    return true
  }
  return false
}

/** Agent work that already appeared before this human row on this flight. */
export function hasAgentWorkBefore(
  nodes: Iterable<TimedChatRow>,
  messageId: number,
  latestTurn?: number | null,
): boolean {
  for (const node of nodes) {
    if (!isAgentWorkRow(node.kind)) continue
    if (node.location !== undefined && isHistoricClosedTurn(node.location, latestTurn)) continue
    const id = rowSteerIdentity(node.data)
    if (typeof id === 'number' && id < messageId) return true
  }
  return false
}

function rowText(data: TimedChatRow['data']): string {
  const parts: string[] = []
  for (const block of data?.content ?? []) {
    if (block !== null && typeof block === 'object' && 'type' in block
      && (block as { type: string }).type === 'text'
      && typeof (block as { text?: unknown }).text === 'string') {
      parts.push((block as { text: string }).text)
    }
  }
  return parts.join('')
}

/** Seq when present (unique); otherwise the wall clock. Same-millisecond follow-ups must not share opener identity. */
export function rowSteerIdentity(data: TimedChatRow['data']): number | undefined {
  if (typeof data?.seq === 'number') return data.seq
  const nested = (data as { readonly finalNode?: { readonly seq?: number } } | undefined)?.finalNode?.seq
  if (typeof nested === 'number') return nested
  if (typeof data?.time === 'number') return data.time
  return undefined
}

function openerUserText(rows: readonly TimedChatRow[], latestTurn?: number | null): string {
  let openerText = ''
  let earliest = Number.POSITIVE_INFINITY
  for (const node of rows) {
    if (node.kind !== 'user') continue
    if (node.location !== undefined && isHistoricClosedTurn(node.location, latestTurn)) continue
    const id = rowSteerIdentity(node.data)
    if (id === undefined || id >= earliest) continue
    earliest = id
    openerText = rowText(node.data)
  }
  return openerText
}

function collectLiveUserShaped(
  nodes: Iterable<TimedChatRow>,
  pick: (data: TimedChatRow['data']) => number | undefined,
  latestTurn?: number | null,
): number[] {
  const rows = [...nodes]
  const openerText = openerUserText(rows, latestTurn)
  const ids: number[] = []
  for (const node of rows) {
    if (!isUserShaped(node.kind)) continue
    if (node.location !== undefined && isHistoricClosedTurn(node.location, latestTurn)) continue
    if (node.kind === 'steering' && openerText !== '' && rowText(node.data) === openerText) continue
    const id = pick(node.data)
    if (typeof id === 'number') ids.push(id)
  }
  return ids
}

/** User-shaped clocks that still belong to live work (not a prior closed 轮次). */
export function collectUserShapedTimes(
  nodes: Iterable<TimedChatRow>,
  latestTurn?: number | null,
): number[] {
  return collectLiveUserShaped(nodes, data => data?.time, latestTurn)
}

/** User-shaped seqs (fallback time) for opener vs 插队 identity. */
export function collectUserShapedSeqs(
  nodes: Iterable<TimedChatRow>,
  latestTurn?: number | null,
): number[] {
  return collectLiveUserShaped(nodes, rowSteerIdentity, latestTurn)
}

/** Composer 插队/排队 once this conversation already has a live-turn opener. */
export function composerDeliveryBusy(live: boolean, userTimes: readonly number[]): boolean {
  return live && userTimes.length > 0
}

/** Earliest live-turn user-shaped seq (or time) is the opener. */
export function isTurnOpenerRow(messageId: number, userIds: readonly number[]): boolean {
  if (userIds.length === 0) return true
  return messageId === Math.min(...userIds)
}

export type PendingInputChrome = 'steer' | 'send'

/**
 * Durable 「插队中」. Any user-shaped row that is not this turn's opener
 * stays 插队 while Host `running` is true. Identity is seq, not clock:
 * two Ctrl+Enter rows in the same millisecond are still first vs rest.
 * Stop clears `running` before tools drain — follow-ups go idle with Stop.
 */
/**
 * Host promoted this row and the same turn ran `step/start` after it
 * (`messageId` is the event seq): the steer became the next request's opener,
 * so it stays in the body and the waiting line drops below it. A steer that
 * is still waiting for its step (发送中) keeps the trailing cluster.
 */
function openedNextStep(location: ConversationLocation, seq: number): boolean {
  if (location.kind !== 'turn' && location.kind !== 'step') return false
  const last = location.turn.steps?.at(-1)
  return last?.start !== undefined && last.start.seq > seq
}

export function durableSteerPending(
  kind: string,
  location: ConversationLocation,
  messageId: number,
  live: boolean,
  userIds: readonly number[] = [],
  hasAgentWork = false,
  latestTurn?: number | null,
): boolean {
  if (!isUserShaped(kind)) return false
  if (isHistoricClosedTurn(location, latestTurn)) return false
  // Promoted into the next request: body above waiting (not trailing).
  if (openedNextStep(location, messageId)) return false
  if (isTurnOpenerRow(messageId, userIds) && (kind === 'user' || !hasAgentWork)) return false
  return live
}

/** Merge consecutive send-state rows; keep mid-turn steers as one bubble each. */
export function groupPendingByChrome<T>(
  items: readonly T[],
  chromeOf: (item: T) => PendingInputChrome,
): readonly { readonly chrome: PendingInputChrome; readonly items: readonly T[] }[] {
  const groups: { chrome: PendingInputChrome; items: T[] }[] = []
  for (const item of items) {
    const chrome = chromeOf(item)
    const last = groups.at(-1)
    if (chrome === 'send' && last?.chrome === 'send') {
      last.items.push(item)
      continue
    }
    groups.push({ chrome, items: [item] })
  }
  return groups
}
