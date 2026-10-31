/**
 * Whole-log 轮次 chrome on chat rows.
 *
 * Only the Host-turn opener paints 「第 N 轮」. Mid-turn human rows (durable
 * 插话, or a `user` row that lost its inbox claim) paint 「第 N 轮 插话」.
 * Auto-continue 「继续」 stays a user bubble but never repeats the round mark.
 */

export type RoundLabelKind = 'turn' | 'steer'

const TURN_KEY = 'chat.turnNavigation.turn' as const
const STEER_KEY = 'chat.turnNavigation.steer' as const

/** Locale key for a resolved round-label kind. */
export function roundLabelLocaleKey(
  kind: RoundLabelKind,
): typeof TURN_KEY | typeof STEER_KEY {
  return kind === 'steer' ? STEER_KEY : TURN_KEY
}

/**
 * Label kind for a durable `user` row.
 * @returns `null` when this row should not paint a round mark.
 */
export function userRoundLabelKind(
  nodeKey: string,
  hostTurn: number | undefined,
  openerKeyByTurn: ReadonlyMap<number, string>,
  sourceKind: string | undefined,
): RoundLabelKind | null {
  if (sourceKind === 'auto-continue') return null
  if (hostTurn === undefined) return 'turn'
  const opener = openerKeyByTurn.get(hostTurn)
  // Rail not ready yet — keep the opener wording so a first paint does not
  // flash 「插话」 on the real turn-opening send.
  if (opener === undefined) return 'turn'
  return opener === nodeKey ? 'turn' : 'steer'
}

/** Loaded-rail opener keys keyed by Host turn (jump / `data-chat-turn`). */
export function openerKeysFromRail(
  items: readonly { readonly turn: number; readonly anchor: { readonly kind: string; readonly key?: string } }[],
): ReadonlyMap<number, string> {
  const map = new Map<number, string>()
  for (const item of items) {
    if (item.anchor.kind === 'loaded' && typeof item.anchor.key === 'string' && item.anchor.key !== '') {
      map.set(item.turn, item.anchor.key)
    }
  }
  return map
}
