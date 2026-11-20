/**
 * Overview / PresenceDock ball mount scale.
 *
 * Boss seats read Settings `ui-presence.size`. Member seats (经理 / 干员) read
 * `appearance.size`, defaulting to 1 when Host omits the wire field — never
 * borrow the boss size (that made 经理 follow 老板 slider).
 *
 * Dual-ball (`pairSeat`): soft-clamp extremes so a low boss slider cannot make
 * 委派方 tiny beside a default-sized 被委派方. Layout width for both seats is
 * shared via CSS `--xrk-delegate-stage` on `.delegatePair` (stack-count aware);
 * this function only trims the in-stage bitmap.
 */

import { DEFAULT_PRESENCE_SIZE } from '../presence-settings.ts'

/** Soft clamp for Overview pair seats — still honors trim, avoids extremes. */
function pairBalancedSize(raw: number): number {
  if (!Number.isFinite(raw)) return DEFAULT_PRESENCE_SIZE
  return Math.min(1.06, Math.max(0.92, raw))
}

export function resolvePresenceStageSize(options: {
  readonly compact: boolean
  readonly memberLook: { readonly size?: number } | undefined
  readonly bossSize: number
  /** Overview 委派方 / 被委派方 pair — balance visual weight. */
  readonly pairSeat?: boolean
}): number {
  if (options.compact) return 1
  const raw = options.memberLook !== undefined
    ? (typeof options.memberLook.size === 'number'
      ? options.memberLook.size
      : DEFAULT_PRESENCE_SIZE)
    : options.bossSize
  return options.pairSeat ? pairBalancedSize(raw) : raw
}
