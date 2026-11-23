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
 * Absent patch fields keep the snapshot. Present fields win — including `''`
 * overlays and kit clears (`'none'`), which must not fall through.
 */
export function mergeTeamRosterLiveLook<T extends object>(
  base: T,
  look: TeamRosterLiveLook | undefined,
): T {
  if (!look) return base
  return {
    ...base,
    ...(look.shape !== undefined && look.shape !== '' ? { shape: look.shape } : {}),
    ...(look.color !== undefined && look.color !== '' ? { color: look.color } : {}),
    ...(typeof look.size === 'number' ? { size: look.size } : {}),
    ...(look.kit !== undefined ? { kit: look.kit } : {}),
    ...(look.kitHat !== undefined ? { kitHat: look.kitHat } : {}),
    ...(look.kitGlasses !== undefined ? { kitGlasses: look.kitGlasses } : {}),
    ...(look.kitHeld !== undefined ? { kitHeld: look.kitHeld } : {}),
    ...(look.overlayHat !== undefined ? { overlayHat: look.overlayHat } : {}),
    ...(look.overlayGlasses !== undefined ? { overlayGlasses: look.overlayGlasses } : {}),
    ...(look.overlayHeld !== undefined ? { overlayHeld: look.overlayHeld } : {}),
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
  if (delegate.childMemberId) return delegate.childMemberId
  // Seed ids when Face omits memberId (older Hosts / brief Status gaps).
  // Keep in sync with Face `MANAGER_MEMBER_ID` / `SUNFLOWER_MEMBER_ID`.
  if (delegate.childSeat === 'manager') return 'mem_seed_manager'
  if (delegate.childSeat === 'sunflower') return 'mem_seed_xrkseek'
  return undefined
}
