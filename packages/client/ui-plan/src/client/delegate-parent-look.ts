/**
 * Resolve Overview left-stack (委派方) looks for N parents.
 * Lead prefers Face `parentCompanionBall`; ancestors use Face `parents[].look`
 * then Team roster live patches — relationship chain, not lead-only hardcode.
 */
import { readTeamRosterLive } from '@xrkseek/client-runtime/client'
import { PENDING_MEMBER_LOOK } from './pending-member-look.ts'
import { mergeTeamRosterLiveLook } from './team-live-look.ts'

export type DelegateParentLook = {
  readonly shape: string
  readonly color: string
  readonly size?: number
  readonly kit?: string
  readonly kitHat?: string
  readonly kitGlasses?: string
  readonly kitHeld?: string
  readonly overlayHat?: string
  readonly overlayGlasses?: string
  readonly overlayHeld?: string
}

export type DelegateParentRow = {
  readonly sessionId: string
  readonly label?: string
  readonly memberId?: string
  readonly kind?: 'boss' | 'opener' | 'peer' | 'ancestor'
  readonly look?: DelegateParentLook
}

/**
 * @param isLead — last parents[] entry (immediate 委派方)
 * @param leadSnapshot — Face `parentCompanionBall` (immediate only)
 */
export function resolveDelegateParentLook(options: {
  readonly parent: DelegateParentRow
  readonly isLead: boolean
  readonly isBossLayer: boolean
  readonly leadSnapshot?: DelegateParentLook
}): DelegateParentLook | undefined {
  if (options.isBossLayer) return undefined
  const live = options.parent.memberId
    ? readTeamRosterLive(options.parent.memberId)?.appearance
    : undefined
  if (options.isLead) {
    const base = options.leadSnapshot ?? options.parent.look ?? PENDING_MEMBER_LOOK
    return mergeTeamRosterLiveLook(base, live)
  }
  if (options.parent.look) {
    return mergeTeamRosterLiveLook(options.parent.look, live)
  }
  if (live) {
    return mergeTeamRosterLiveLook(PENDING_MEMBER_LOOK, live)
  }
  return undefined
}

/** Visual depth from the lead (0 = lead). Used for stack scale/opacity. */
export function delegateParentDepthFromLead(
  index: number,
  chainLength: number,
): number {
  return Math.max(0, chainLength - 1 - index)
}
