import type {
  ConversationLocation,
  ConversationTimelineSnapshot,
} from '@xrkseek/client-runtime/client'

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
 * Mid-turn steer (「插队中」) only while an agent turn is still open.
 * After that turn yields — even if Host `running` lags — the same rows are
 * the next user send (ordinary idle chrome).
 */
export function isMidTurnSteer(
  running: boolean,
  turnOpen: boolean,
  openTurnStart: number | null,
  at: number,
): boolean {
  if (!running || !turnOpen) return false
  if (openTurnStart === null) return true
  return at >= openTurnStart
}

export type PendingInputChrome = 'steer' | 'send'

export function pendingInputChrome(
  running: boolean,
  turnOpen: boolean,
  openTurnStart: number | null,
  at: number | undefined,
): PendingInputChrome {
  if (!running || !turnOpen) return 'send'
  if (at === undefined) return 'steer'
  return isMidTurnSteer(running, turnOpen, openTurnStart, at) ? 'steer' : 'send'
}

/** Durable steering keeps「插队中」only for the still-open owning turn. */
export function durableSteerPending(
  kind: string,
  running: boolean,
  location: ConversationLocation,
  messageTime: number,
  turnOpen: boolean,
  openTurnStart: number | null,
): boolean {
  if (kind !== 'steering' || !running) return false
  if (location.kind === 'turn' || location.kind === 'step') {
    return location.turn.status === 'open'
  }
  if (location.kind !== 'session') return false
  if (!turnOpen) return false
  if (openTurnStart === null) return true
  return messageTime >= openTurnStart
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
