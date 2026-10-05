/**
 * View-layer union of the host turn outline and the loaded rail items. The
 * conversation snapshot never carries projection values, so this merge is the
 * one place the rail's two sources meet: the `turnOutline` projection names
 * every 轮次 of the session, and the loaded window supplies anchors and
 * richer previews for the turns it holds.
 *
 * `round` is the whole-log 轮次 (90-turn session, tail still says 87 — never
 * re-indexed to 1). The navigator slides a 10-mark camera over that ladder
 * and, when the reader is not on the tail, pins the session newest as an
 * 11th floor tick (jump back to the bottom).
 */

import type { TurnNavigationItem } from '@xrkseek/client-runtime/client'

/** One rail mark: a loaded 轮次 scrolls to its opening user row; an unloaded one pages history through its seq first. */
export interface TurnRailItem {
  /** Host turn id (jump / `data-chat-turn`). Not the user-facing 轮次 index. */
  readonly turn: number
  /** Whole-log 轮次 (1-based). 插话 never occupies a slot. */
  readonly round: number
  /** Bounded prompt preview (loaded window first, outline fallback). */
  readonly prompt: string
  /** Bounded response preview (loaded window first, outline fallback). */
  readonly response: string
  /** How the rail reaches the Turn. */
  readonly anchor:
    | { readonly kind: 'loaded'; readonly key: string }
    | { readonly kind: 'unloaded'; readonly seq: number }
}

/** Camera marks around the reading turn. The session newest may pin as an extra floor tick. */
export const TURN_RAIL_WINDOW = 10

const EMPTY_ITEMS: readonly TurnRailItem[] = []
const EMPTY_TURNS: readonly number[] = []

type DraftItem = Omit<TurnRailItem, 'round'> & { round: number }

function outlineEntry(value: unknown): {
  turn: number
  seq: number
  prompt: string
  response: string
  round?: number
} | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const entry = value as {
    turn?: unknown
    seq?: unknown
    prompt?: unknown
    response?: unknown
    round?: unknown
  }
  if (typeof entry.turn !== 'number' || !Number.isSafeInteger(entry.turn) || entry.turn < 0) return undefined
  if (typeof entry.seq !== 'number' || !Number.isSafeInteger(entry.seq) || entry.seq < 0) return undefined
  const round = typeof entry.round === 'number' && Number.isSafeInteger(entry.round) && entry.round >= 1
    ? entry.round
    : undefined
  return {
    turn: entry.turn,
    seq: entry.seq,
    prompt: typeof entry.prompt === 'string' ? entry.prompt : '',
    response: typeof entry.response === 'string' ? entry.response : '',
    ...(round === undefined ? {} : { round }),
  }
}

function outlineEntries(outline: unknown): readonly unknown[] {
  return Array.isArray(outline) ? outline : EMPTY_ITEMS
}

/**
 * Merge the host outline with the loaded 轮次 items into the full ladder.
 * Host `turn` is the jump key; `round` is the whole-log 轮次 (Face `round`, or
 * the prompted index before 插话 is dropped — never the loaded-window index).
 */
export function mergeTurnRailItems(
  loaded: readonly TurnNavigationItem[],
  outline: unknown,
  windowTurnStarts: readonly number[] = EMPTY_TURNS,
): readonly TurnRailItem[] {
  const loadedByTurn = new Map<number, TurnNavigationItem>()
  for (const item of loaded) loadedByTurn.set(item.turn, item)
  const startInWindow = new Set(windowTurnStarts)
  const byTurn = new Map<number, DraftItem>()
  const outlineRows: NonNullable<ReturnType<typeof outlineEntry>>[] = []
  for (const raw of outlineEntries(outline)) {
    const entry = outlineEntry(raw)
    if (entry === undefined) continue
    outlineRows.push(entry)
  }
  outlineRows.sort((left, right) => left.turn - right.turn)
  let prompted = 0
  for (const entry of outlineRows) {
    if (entry.prompt === '' && !loadedByTurn.has(entry.turn)) continue
    prompted += 1
    const round = entry.round ?? prompted
    if (startInWindow.has(entry.turn) && !loadedByTurn.has(entry.turn)) continue
    byTurn.set(entry.turn, {
      turn: entry.turn,
      prompt: entry.prompt,
      response: entry.response,
      anchor: { kind: 'unloaded', seq: entry.seq },
      round,
    })
  }
  for (const item of loaded) {
    const preview = byTurn.get(item.turn)
    byTurn.set(item.turn, {
      turn: item.turn,
      prompt: item.prompt !== '' ? item.prompt : preview?.prompt ?? '',
      response: item.response !== '' ? item.response : preview?.response ?? '',
      anchor: { kind: 'loaded', key: item.anchorKey },
      round: preview?.round ?? prompted + 1,
    })
    if (preview === undefined) prompted += 1
  }
  if (byTurn.size === 0) return EMPTY_ITEMS
  return [...byTurn.values()].sort((left, right) => left.turn - right.turn)
}

/**
 * Camera of `size` marks ending at the reading turn, plus the session newest
 * pinned as a floor tick when it is not already in that camera (11 marks).
 * On the tail the floor is the newest itself — no extra tick.
 */
export function slideTurnRailWindow(
  items: readonly TurnRailItem[],
  focusTurn: number | null,
  size: number = TURN_RAIL_WINDOW,
): readonly TurnRailItem[] {
  if (size < 1 || items.length <= size) return items
  const newestIndex = items.length - 1
  const newest = items[newestIndex]
  if (newest === undefined) return items
  let focus = newestIndex
  if (focusTurn !== null) {
    const index = items.findIndex(item => item.turn === focusTurn)
    if (index >= 0) focus = index
  }
  if (focus === newestIndex) return items.slice(items.length - size)
  let start = focus - (size - 1)
  if (start < 0) start = 0
  let end = start + size
  if (end > newestIndex) {
    end = newestIndex
    start = Math.max(0, end - size)
  }
  return [...items.slice(start, end), newest]
}
