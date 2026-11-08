/**
 * Overview / PresenceDock ball mount scale.
 *
 * Boss seats read Settings `ui-presence.size`. Member seats (经理 / 干员) read
 * `appearance.size`, defaulting to 1 when Host omits the wire field — never
 * borrow the boss size (that made 经理 follow 老板 slider).
 */

import { DEFAULT_PRESENCE_SIZE } from '../presence-settings.ts'

export function resolvePresenceStageSize(options: {
  readonly compact: boolean
  readonly memberLook: { readonly size?: number } | undefined
  readonly bossSize: number
}): number {
  if (options.compact) return 1
  if (options.memberLook !== undefined) {
    return typeof options.memberLook.size === 'number'
      ? options.memberLook.size
      : DEFAULT_PRESENCE_SIZE
  }
  return options.bossSize
}
