/**
 * Live seat titles for speech-bubble identity chips (manager / agent / boss).
 * Wired from ui-plan presence prefs — never hardcode 经理 / 干员 in Face UI.
 *
 * Message rows must subscribe ({@link subscribeSpeechSeatTitles}) so a Settings
 * titleScheme / custom-title switch repaints past turns without a remount.
 */

export type SpeechSeatTitles = {
  readonly boss: string
  readonly manager: string
  readonly agent: string
}

type TitlesResolve = () => SpeechSeatTitles

let resolveTitles: TitlesResolve | undefined
const listeners = new Set<() => void>()
let snapshotCache: SpeechSeatTitles | null = null
let snapshotReady = false

function sameTitles(
  a: SpeechSeatTitles | null,
  b: SpeechSeatTitles | null,
): boolean {
  if (a === b) return true
  if (a === null || b === null) return false
  return a.boss === b.boss && a.manager === b.manager && a.agent === b.agent
}

function publish(): void {
  snapshotReady = false
  for (const listener of [...listeners]) listener()
}

/** Wire Settings `ui-presence` seat titles from ui-plan. */
export function bindSpeechSeatTitles(resolve: TitlesResolve): void {
  resolveTitles = resolve
  publish()
}

/**
 * Presence prefs / locale changed — drop the fingerprint so subscribers
 * re-read {@link resolveSpeechSeatTitles}.
 */
export function notifySpeechSeatTitlesChanged(): void {
  publish()
}

/** Subscribe to seat-title changes (speech chips / captions). */
export function subscribeSpeechSeatTitles(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange)
  return () => {
    listeners.delete(onStoreChange)
  }
}

/** Current seat titles, or `null` when presence prefs are not bound yet. */
export function resolveSpeechSeatTitles(): SpeechSeatTitles | null {
  const titles = resolveTitles?.()
  if (titles === undefined) return null
  const boss = titles.boss.trim()
  const manager = titles.manager.trim()
  const agent = titles.agent.trim()
  if (boss === '' && manager === '' && agent === '') return null
  return { boss, manager, agent }
}

/**
 * Reference-stable snapshot for `useSyncExternalStore`.
 * Reuses the prior object when boss/manager/agent strings are unchanged.
 */
export function speechSeatTitlesSnapshot(): SpeechSeatTitles | null {
  const next = resolveSpeechSeatTitles()
  if (snapshotReady && sameTitles(snapshotCache, next)) return snapshotCache
  snapshotCache = next
  snapshotReady = true
  return next
}
