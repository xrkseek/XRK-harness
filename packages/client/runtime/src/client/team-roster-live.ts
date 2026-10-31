/**
 * Optimistic Team roster paint (nickname + look) shared by 干员团队 edits and
 * Overview / dock captions — Face status poll converges; this is the hot path.
 */

export type TeamRosterLiveLook = {
  readonly shape?: string
  readonly color?: string
  readonly kit?: string
  readonly kitHat?: string
  readonly kitGlasses?: string
  readonly kitHeld?: string
  readonly overlayHat?: string
  readonly overlayGlasses?: string
  readonly overlayHeld?: string
}

export type TeamRosterLivePatch = {
  /** Formal roster name (名称) — Overview falls back when nick is empty. */
  readonly name?: string | null
  readonly nickname?: string | null
  readonly appearance?: TeamRosterLiveLook
}

type Listener = () => void

let revision = 0
const byId = new Map<string, TeamRosterLivePatch>()
const listeners = new Set<Listener>()

function notify(): void {
  revision += 1
  for (const listener of listeners) listener()
}

/** Merge a live patch for one roster member and wake subscribers. */
export function patchTeamRosterLive(
  memberId: string,
  patch: TeamRosterLivePatch,
): void {
  const id = memberId.trim()
  if (!id) return
  const prior = byId.get(id)
  byId.set(id, {
    ...(prior ?? {}),
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.nickname !== undefined ? { nickname: patch.nickname } : {}),
    ...(patch.appearance
      ? { appearance: { ...(prior?.appearance ?? {}), ...patch.appearance } }
      : {}),
  })
  notify()
}

/** Drop optimistic paint (Host status is authoritative again). */
export function clearTeamRosterLive(memberId?: string): void {
  if (memberId === undefined) {
    if (byId.size === 0) return
    byId.clear()
  } else {
    const id = memberId.trim()
    if (!id || !byId.has(id)) return
    byId.delete(id)
  }
  notify()
}

export function readTeamRosterLive(memberId: string): TeamRosterLivePatch | undefined {
  const id = memberId.trim()
  if (!id) return undefined
  return byId.get(id)
}

export function teamRosterLiveRevision(): number {
  return revision
}

export function subscribeTeamRosterLive(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
