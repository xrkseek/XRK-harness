/**
 * Per-Session Overview chrome memory (open bit + last width).
 * Survives reload via localStorage (same habit as community sidebar state).
 * Parent↔child lineage hops inherit an open column so delegation does not slam it shut.
 */
// Leaf import: keep this module free of the client barrel (`window` via slots).
import { isSessionLineageHop } from '@xrkseek/client-runtime/client'
import { clampWidth, DETAILS_DEFAULT, DETAILS_MAX, DETAILS_MIN } from './columns.ts'

const MAX_SESSIONS = 48
const STORAGE_KEY = 'xrk.layout.overview.v1'

export type DetailsChrome = {
  readonly open: boolean
  /** Last non-zero Overview width for this Session (drag habit). */
  readonly width: number
}

const bySession = new Map<string, DetailsChrome>()

function defaultStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null {
  return typeof localStorage !== 'undefined' ? localStorage : null
}

function clampDetailsWidth(px: number): number {
  return clampWidth(px, DETAILS_MIN, DETAILS_MAX)
}

function parseChrome(raw: unknown): DetailsChrome | undefined {
  if (raw === null || typeof raw === 'undefined') return undefined
  if (typeof raw === 'boolean') {
    // v0 open-only rows (pre-width): keep open bit, default width.
    return { open: raw, width: DETAILS_DEFAULT }
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const row = raw as Record<string, unknown>
  if (typeof row.open !== 'boolean') return undefined
  const width = typeof row.width === 'number' && Number.isFinite(row.width)
    ? clampDetailsWidth(row.width)
    : DETAILS_DEFAULT
  return { open: row.open, width }
}

function hydrate(storage: Pick<Storage, 'getItem'> | null): void {
  if (storage === null || bySession.size > 0) return
  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (raw === null || raw === '') return
    const parsed = JSON.parse(raw) as unknown
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return
    const entries = Object.entries(parsed as Record<string, unknown>)
    // Preserve insertion order as LRU (oldest first) when the document is an object.
    for (const [id, value] of entries) {
      if (typeof id !== 'string' || id.trim() === '') continue
      const chrome = parseChrome(value)
      if (chrome === undefined) continue
      bySession.set(id, chrome)
    }
    while (bySession.size > MAX_SESSIONS) {
      const oldest = bySession.keys().next().value
      if (oldest === undefined) break
      bySession.delete(oldest)
    }
  } catch {
    // Corrupt / blocked storage → start empty.
  }
}

function persist(storage: Pick<Storage, 'setItem' | 'removeItem'> | null = defaultStorage()): void {
  if (storage === null) return
  try {
    if (bySession.size === 0) {
      storage.removeItem(STORAGE_KEY)
      return
    }
    const doc: Record<string, DetailsChrome> = {}
    for (const [id, chrome] of bySession) doc[id] = chrome
    storage.setItem(STORAGE_KEY, JSON.stringify(doc))
  } catch {
    // Quota / private mode — memory still works for the tab lifetime.
  }
}

function ensureHydrated(): void {
  hydrate(defaultStorage())
}

/** Test-only reset (memory + optional storage). */
export function resetDetailsOpenMemoryForTests(
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null = defaultStorage(),
): void {
  bySession.clear()
  if (storage !== null) {
    try {
      storage.removeItem(STORAGE_KEY)
    } catch {
      // ignore
    }
  }
}

/** Read remembered chrome for one Session (undefined = never visited). */
export function readDetailsChrome(sessionId: string): DetailsChrome | undefined {
  ensureHydrated()
  return bySession.get(sessionId)
}

/** @deprecated Prefer {@link readDetailsChrome}; kept for call-site clarity. */
export function readDetailsOpen(sessionId: string): boolean | undefined {
  return readDetailsChrome(sessionId)?.open
}

/** Persist open bit (+ optional width) for one Session. */
export function rememberDetailsOpen(
  sessionId: string,
  open: boolean,
  width?: number,
  storage: Pick<Storage, 'setItem' | 'removeItem'> | null = defaultStorage(),
): void {
  ensureHydrated()
  const prev = bySession.get(sessionId)
  const nextWidth = width !== undefined
    ? clampDetailsWidth(width)
    : (prev?.width ?? DETAILS_DEFAULT)
  bySession.delete(sessionId)
  bySession.set(sessionId, { open, width: nextWidth })
  while (bySession.size > MAX_SESSIONS) {
    const oldest = bySession.keys().next().value
    if (oldest === undefined || oldest === sessionId) break
    bySession.delete(oldest)
  }
  persist(storage)
}

/** Persist drag width for the settled Session (open bit unchanged / stays open). */
export function rememberDetailsWidth(
  sessionId: string,
  width: number,
  storage: Pick<Storage, 'setItem' | 'removeItem'> | null = defaultStorage(),
): void {
  ensureHydrated()
  const prev = bySession.get(sessionId)
  rememberDetailsOpen(sessionId, prev?.open ?? true, width, storage)
}

export type DetailsOpenAction = 'open' | 'close' | 'keep'

export type DetailsChromeDecision = {
  readonly action: DetailsOpenAction
  /** Width to apply for `toId` (always set when a decision is made). */
  readonly width: number
}

/**
 * Session selected (sidebar `setSession` shape): remember the leave Session,
 * then decide whether the shell should open / close / keep Overview for `toId`,
 * plus which width that Session last used.
 */
export function selectDetailsOpenMemory(input: {
  readonly fromId: string | undefined
  readonly fromParentId: string | undefined
  readonly toId: string
  readonly toParentId: string | undefined
  readonly openNow: boolean
  /** Current shell width preference (open column or detailsLast). */
  readonly widthNow: number
}): DetailsChromeDecision {
  ensureHydrated()
  const { fromId, fromParentId, toId, toParentId, openNow, widthNow } = input
  const leaveWidth = openNow && widthNow > 0 ? clampDetailsWidth(widthNow) : undefined
  if (fromId !== undefined && fromId !== toId) {
    rememberDetailsOpen(fromId, openNow, leaveWidth)
  }

  const remembered = readDetailsChrome(toId)
  if (remembered !== undefined) {
    if (remembered.open) {
      return { action: openNow ? 'keep' : 'open', width: remembered.width }
    }
    return { action: openNow ? 'close' : 'keep', width: remembered.width }
  }

  // Never visited: lineage hop keeps an already-open column; else close.
  if (
    openNow
    && fromId !== undefined
    && isSessionLineageHop(fromId, fromParentId, toId, toParentId)
  ) {
    const width = leaveWidth ?? clampDetailsWidth(widthNow > 0 ? widthNow : DETAILS_DEFAULT)
    rememberDetailsOpen(toId, true, width)
    return { action: 'keep', width }
  }
  rememberDetailsOpen(toId, false, DETAILS_DEFAULT)
  return {
    action: openNow ? 'close' : 'keep',
    width: DETAILS_DEFAULT,
  }
}
