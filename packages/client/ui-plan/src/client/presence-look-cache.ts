/**
 * Per-Session companionBall memory + paint resolution.
 *
 * ## Layers (field paint for one Session seat)
 *
 * 1. **Team live patch** — optimistic hot edit (`mergeTeamRosterLiveLook`)
 * 2. **Face `companionBall`** — current Status payload
 * 3. **This cache** — last known look for instant re-enter (any costume)
 * 4. **PENDING cream blob** — only when this Session never disclosed a look
 *    (never Settings boss / ui-presence)
 *
 * `overview-load-cache` still owns full Status for Overview numbers; writing it
 * with a `companionBall` warms this map. Soft faces must not call
 * `session.getSnapshot()` here — write-on-fetch / write-on-live-paint only.
 */
import type { TeamRosterLiveLook } from '@xrkseek/client-runtime/client'
import { mergeTeamRosterLiveLook } from './team-live-look.ts'

const MAX_SESSIONS = 48

/** Opaque companion look — same fields Face puts on `session.status.companionBall`. */
export type PresenceLookSnapshot = {
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

const bySession = new Map<string, PresenceLookSnapshot>()

function isLook(value: unknown): value is PresenceLookSnapshot {
  if (!value || typeof value !== 'object') return false
  const shape = (value as { shape?: unknown }).shape
  const color = (value as { color?: unknown }).color
  return typeof shape === 'string' && shape.length > 0
    && typeof color === 'string' && color.length > 0
}

/** Test-only: drop every remembered look. */
export function resetPresenceLookCacheForTests(): void {
  bySession.clear()
}

/** Last companionBall for one Session (undefined = never seen / evicted). */
export function readPresenceLookCache(
  sessionId: string,
): PresenceLookSnapshot | undefined {
  const row = bySession.get(sessionId)
  if (row === undefined) return undefined
  bySession.delete(sessionId)
  bySession.set(sessionId, row)
  return row
}

/** Remember a companionBall look (any costume; skip empty shape/color). */
export function writePresenceLookCache(
  sessionId: string,
  look: PresenceLookSnapshot,
): void {
  if (!isLook(look)) return
  bySession.delete(sessionId)
  bySession.set(sessionId, look)
  while (bySession.size > MAX_SESSIONS) {
    const oldest = bySession.keys().next().value
    if (oldest === undefined || oldest === sessionId) break
    bySession.delete(oldest)
  }
}

/**
 * Face look wins; else last remembered look for this Session.
 * Does not apply Team live — use {@link resolveCompanionLookWithLive}.
 */
export function resolveCompanionLook(
  sessionId: string,
  face: PresenceLookSnapshot | undefined | null,
): PresenceLookSnapshot | undefined {
  if (isLook(face)) return face
  return readPresenceLookCache(sessionId)
}

/**
 * Disclosed look for paint / `data-pending`: Face → cache → live-only full look.
 * Callers still merge live on top when Face/cache already disclosed a base
 * (live fields win for hot edits).
 */
export function resolveCompanionLookWithLive(
  sessionId: string,
  face: PresenceLookSnapshot | undefined | null,
  live: TeamRosterLiveLook | undefined,
): PresenceLookSnapshot | undefined {
  const base = resolveCompanionLook(sessionId, face)
  if (base) return base
  const shape = live?.shape
  const color = live?.color
  if (typeof shape === 'string' && shape.length > 0
    && typeof color === 'string' && color.length > 0) {
    return mergeTeamRosterLiveLook({ shape, color }, live)
  }
  return undefined
}

/** Persist when Face disclosed a look; no-op when omitted / invalid. */
export function rememberCompanionLook(
  sessionId: string,
  face: PresenceLookSnapshot | undefined | null,
): void {
  if (isLook(face)) writePresenceLookCache(sessionId, face)
}

/**
 * Persist the look the user is currently seeing (Face/cache + Team hot patch).
 * Call from an effect — never during render. Never writes PENDING.
 *
 * Ensures a Team costume edit survives switch-away before Face poll lands.
 */
export function warmCompanionLookFromPaint(
  sessionId: string,
  faceOrCached: PresenceLookSnapshot | undefined,
  live: TeamRosterLiveLook | undefined,
): void {
  if (faceOrCached) {
    rememberCompanionLook(sessionId, mergeTeamRosterLiveLook(faceOrCached, live))
    return
  }
  const shape = live?.shape
  const color = live?.color
  if (typeof shape === 'string' && shape.length > 0
    && typeof color === 'string' && color.length > 0) {
    rememberCompanionLook(
      sessionId,
      mergeTeamRosterLiveLook({ shape, color }, live),
    )
  }
}
