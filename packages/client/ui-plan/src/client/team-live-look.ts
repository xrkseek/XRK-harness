/**
 * Live Team-edit overlay shared by every surface that paints a roster member's
 * ball (Overview pair, header PresenceDock).
 *
 * Module-level on purpose: these run on every status repaint, and `PresenceBall`
 * is `memo`'d — building a fresh object inline in a component body used to
 * defeat that memo, so the ball re-rendered on every poll tick.
 */
import type { TeamRosterLiveLook } from '@xrkseek/client-runtime/client'

/**
 * Overlay an optimistic roster patch on a Face status snapshot.
 * Fields the patch does not carry keep the snapshot's value (including `''`
 * overlays, which must clear rather than fall through).
 */
export function mergeTeamRosterLiveLook<T extends object>(
  base: T,
  look: TeamRosterLiveLook | undefined,
): T {
  if (!look) return base
  return {
    ...base,
    ...(look.shape ? { shape: look.shape } : {}),
    ...(look.color ? { color: look.color } : {}),
    ...(typeof look.size === 'number' ? { size: look.size } : {}),
    ...(look.kit ? { kit: look.kit } : {}),
    ...(look.kitHat ? { kitHat: look.kitHat } : {}),
    ...(look.kitGlasses ? { kitGlasses: look.kitGlasses } : {}),
    ...(look.kitHeld ? { kitHeld: look.kitHeld } : {}),
    ...(look.overlayHat ? { overlayHat: look.overlayHat } : {}),
    ...(look.overlayGlasses ? { overlayGlasses: look.overlayGlasses } : {}),
    ...(look.overlayHeld ? { overlayHeld: look.overlayHeld } : {}),
  }
}

/**
 * Roster member id behind Face `companionBall` — the row a Team edit patches,
 * so the live overlay can find it before the next status poll lands.
 * A delegated child without an explicit member falls back to 经理.
 */
export function companionChildMemberId(
  delegate: { readonly childMemberId?: string; readonly childSeat?: string } | undefined,
): string | undefined {
  if (!delegate) return undefined
  return delegate.childMemberId ?? (delegate.childSeat === 'manager' ? 'mem_seed_manager' : undefined)
}
