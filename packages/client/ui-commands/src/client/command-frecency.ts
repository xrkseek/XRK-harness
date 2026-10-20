/**
 * Device-local command frecency (count × recency decay). Diff-only
 * localStorage — not Host settings.yaml (same posture as shell shortcuts).
 */

/** localStorage key for the frecency document. */
export const COMMAND_FRECENCY_STORAGE_KEY = 'xrk.commands.frecency.v1'

/** One command's use counters. */
export interface CommandFrecencyEntry {
  readonly count: number
  readonly lastUsed: number
}

/** name → counters. */
export type CommandFrecencyDoc = Readonly<Record<string, CommandFrecencyEntry>>

let frecencyCache: CommandFrecencyDoc | undefined

function isDefaultStorage(
  storage: Pick<Storage, 'getItem'> | null,
): boolean {
  return storage === (typeof localStorage !== 'undefined' ? localStorage : null)
}

/** Read frecency map (corrupt → empty). Cached for the default localStorage. */
export function loadCommandFrecency(
  storage: Pick<Storage, 'getItem'> | null = typeof localStorage !== 'undefined' ? localStorage : null,
): CommandFrecencyDoc {
  if (storage === null) return {}
  if (frecencyCache !== undefined && isDefaultStorage(storage)) return frecencyCache
  try {
    const raw = storage.getItem(COMMAND_FRECENCY_STORAGE_KEY)
    if (raw === null || raw === '') {
      if (isDefaultStorage(storage)) frecencyCache = {}
      return {}
    }
    const parsed = JSON.parse(raw) as unknown
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      if (isDefaultStorage(storage)) frecencyCache = {}
      return {}
    }
    const out: Record<string, CommandFrecencyEntry> = {}
    for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (name.trim() === '') continue
      if (value === null || typeof value !== 'object' || Array.isArray(value)) continue
      const count = (value as { count?: unknown }).count
      const lastUsed = (value as { lastUsed?: unknown }).lastUsed
      if (typeof count !== 'number' || !Number.isFinite(count) || count < 1) continue
      if (typeof lastUsed !== 'number' || !Number.isFinite(lastUsed)) continue
      out[name] = { count: Math.floor(count), lastUsed }
    }
    if (isDefaultStorage(storage)) frecencyCache = out
    return out
  } catch {
    if (isDefaultStorage(storage)) frecencyCache = {}
    return {}
  }
}

/** Persist the document (empty → remove key). */
export function saveCommandFrecency(
  doc: CommandFrecencyDoc,
  storage: Pick<Storage, 'setItem' | 'removeItem'> | null = typeof localStorage !== 'undefined' ? localStorage : null,
): void {
  if (isDefaultStorage(storage)) frecencyCache = doc
  if (storage === null) return
  try {
    if (Object.keys(doc).length === 0) {
      storage.removeItem(COMMAND_FRECENCY_STORAGE_KEY)
      return
    }
    storage.setItem(COMMAND_FRECENCY_STORAGE_KEY, JSON.stringify(doc))
  } catch {
    // Quota / private mode — in-memory cache still applies for this tab.
  }
}

/** Bump count + lastUsed for one command name. */
export function recordCommandUse(
  name: string,
  now = Date.now(),
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null = typeof localStorage !== 'undefined' ? localStorage : null,
): CommandFrecencyDoc {
  const trimmed = name.trim()
  if (trimmed === '') return loadCommandFrecency(storage)
  const prev = loadCommandFrecency(storage)
  const prior = prev[trimmed]
  const next: CommandFrecencyDoc = {
    ...prev,
    [trimmed]: {
      count: (prior?.count ?? 0) + 1,
      lastUsed: now,
    },
  }
  saveCommandFrecency(next, storage)
  return next
}

/**
 * Higher = more preferred. Half-life ~14 days on lastUsed; unused → 0.
 * Stable when all scores are 0 so empty catalogs keep declaration order.
 */
export function frecencyScore(
  name: string,
  doc: CommandFrecencyDoc,
  now = Date.now(),
): number {
  const entry = doc[name]
  if (entry === undefined) return 0
  const ageDays = Math.max(0, (now - entry.lastUsed) / 86_400_000)
  return entry.count / (1 + ageDays / 14)
}

/** Test-only: drop the in-memory cache. */
export function clearCommandFrecencyCacheForTests(): void {
  frecencyCache = undefined
}
