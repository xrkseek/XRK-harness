/**
 * Shared companion-ball paint for PresenceDock (header / phone) seats.
 *
 * Applies the layer stack in `presence-look-cache.ts` and warms the look cache
 * after Team hot edits so re-entering the Session keeps the new costume.
 */
import { useEffect, useMemo, useSyncExternalStore } from 'react'
import {
  readTeamRosterLive,
  subscribeTeamRosterLive,
  teamRosterLiveRevision,
} from '@xrkseek/client-runtime/client'
import { PENDING_MEMBER_LOOK } from './pending-member-look.ts'
import {
  resolveCompanionLook,
  resolveCompanionLookWithLive,
  warmCompanionLookFromPaint,
  type PresenceLookSnapshot,
} from './presence-look-cache.ts'
import {
  companionChildMemberId,
  mergeTeamRosterLiveLook,
} from './team-live-look.ts'

export function useCompanionMemberLook(
  sessionId: string,
  faceCompanionBall: PresenceLookSnapshot | undefined,
  delegate: { readonly childMemberId?: string; readonly childSeat?: string } | undefined,
): {
  readonly paintedLook: PresenceLookSnapshot | undefined
  readonly memberLook: typeof PENDING_MEMBER_LOOK & Record<string, unknown>
} {
  const rosterLiveRev = useSyncExternalStore(
    subscribeTeamRosterLive,
    teamRosterLiveRevision,
    () => 0,
  )
  const liveChildLook = (() => {
    const id = companionChildMemberId(delegate)
    return id ? readTeamRosterLive(id)?.appearance : undefined
  })()

  // Face/cache base (for warm); disclosed includes live-only full looks.
  const faceOrCached = resolveCompanionLook(sessionId, faceCompanionBall)
  const paintedLook = resolveCompanionLookWithLive(
    sessionId,
    faceCompanionBall,
    liveChildLook,
  )
  const memberLook = useMemo(
    () => mergeTeamRosterLiveLook(
      paintedLook ?? PENDING_MEMBER_LOOK,
      // When paintedLook is live-only it already includes live fields; merging
      // again is idempotent and keeps Face/cache + live field-wins correct.
      liveChildLook,
    ),
    // `rosterLiveRev` wakes when Team patches appearance without a Face poll.
    [paintedLook, liveChildLook, rosterLiveRev],
  )

  useEffect(() => {
    // Warm from Face/cache base + live so hot edits survive switch-away.
    warmCompanionLookFromPaint(sessionId, faceOrCached ?? paintedLook, liveChildLook)
  }, [sessionId, faceOrCached, paintedLook, liveChildLook, rosterLiveRev])

  return { paintedLook, memberLook }
}
