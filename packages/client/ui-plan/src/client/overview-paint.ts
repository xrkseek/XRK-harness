/**
 * Per-Session Overview UI memory (tab · per-tab scroll · last paint).
 * Same habit as community sidebar: leave a Session, come back — chrome is where you left it.
 * Shell width / open lives in the layout store (global); this map is Session-scoped content chrome.
 */
// Leaf import: the client barrel touches `window` (slots); this module is unit-tested in Node.
import { isSessionLineageHop } from '@xrkseek/client-runtime/client'
import type { PreviewTabLoad } from './preview-load.ts'

export type OverviewPaintTab = 'status' | 'context' | 'todos' | 'changes' | 'canvas'

export const OVERVIEW_PAINT_TABS = [
  'status',
  'changes',
  'context',
  'todos',
  'canvas',
] as const satisfies readonly OverviewPaintTab[]

export type OverviewSessionUi = {
  readonly tab: OverviewPaintTab
  /** Scroll offset for the active tab (derived from {@link scrollByTab}). */
  readonly scrollTop: number
  /** Per-tab body scroll — switching tabs restores that tab's own offset. */
  readonly scrollByTab: Readonly<Partial<Record<OverviewPaintTab, number>>>
  readonly parentId: string | undefined
  readonly loaded: PreviewTabLoad | null
}

/** Cap remembered Sessions (LRU). Soft hops only need a short recent window. */
const MAX_SESSIONS = 48

const bySession = new Map<string, OverviewSessionUi>()
let lastVisited: string | undefined

/** Test-only: drop every remembered Session chrome row. */
export function resetOverviewSessionUiForTests(): void {
  bySession.clear()
  lastVisited = undefined
}

function scrollOf(
  scrollByTab: Readonly<Partial<Record<OverviewPaintTab, number>>>,
  tab: OverviewPaintTab,
): number {
  const value = scrollByTab[tab]
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

function pack(
  tab: OverviewPaintTab,
  scrollByTab: Readonly<Partial<Record<OverviewPaintTab, number>>>,
  parentId: string | undefined,
  loaded: PreviewTabLoad | null,
): OverviewSessionUi {
  return {
    tab,
    scrollTop: scrollOf(scrollByTab, tab),
    scrollByTab,
    parentId,
    loaded,
  }
}

/** Bump Session to most-recent; drop oldest when over cap. */
function commit(sessionId: string, next: OverviewSessionUi): void {
  bySession.delete(sessionId)
  bySession.set(sessionId, next)
  lastVisited = sessionId
  while (bySession.size > MAX_SESSIONS) {
    const oldest = bySession.keys().next().value
    if (oldest === undefined || oldest === sessionId) break
    bySession.delete(oldest)
  }
}

/** Read remembered chrome for one Session (undefined = never visited). */
export function readOverviewSessionUi(sessionId: string): OverviewSessionUi | undefined {
  return bySession.get(sessionId)
}

/** Scroll offset remembered for one tab (0 when never scrolled). */
export function readOverviewScroll(
  sessionId: string,
  tab: OverviewPaintTab,
): number {
  const row = bySession.get(sessionId)
  if (row === undefined) return 0
  return scrollOf(row.scrollByTab, tab)
}

export type OverviewSessionUiPatch = {
  readonly tab?: OverviewPaintTab
  /** Writes into {@link OverviewSessionUi.scrollByTab} for `tab` (or the active tab). */
  readonly scrollTop?: number
  readonly scrollByTab?: Readonly<Partial<Record<OverviewPaintTab, number>>>
  readonly parentId?: string | undefined
  readonly loaded?: PreviewTabLoad | null
}

/** Merge chrome for one Session (partial patch). */
export function writeOverviewSessionUi(
  sessionId: string,
  patch: OverviewSessionUiPatch,
): void {
  const prev = bySession.get(sessionId)
  const tab = patch.tab ?? prev?.tab ?? 'status'
  const scrollByTab: Partial<Record<OverviewPaintTab, number>> = {
    ...(prev?.scrollByTab ?? {}),
    ...(patch.scrollByTab ?? {}),
  }
  if (patch.scrollTop !== undefined) {
    const y = patch.scrollTop
    scrollByTab[tab] = Number.isFinite(y) && y > 0 ? y : 0
  }
  commit(
    sessionId,
    pack(
      tab,
      scrollByTab,
      patch.parentId !== undefined ? patch.parentId : prev?.parentId,
      patch.loaded !== undefined ? patch.loaded : (prev?.loaded ?? null),
    ),
  )
}

/**
 * Initial paint for a Session remount:
 * - own memory wins for tab · scroll · loaded
 * - else parent↔child soft handoff of the previous *loaded* only (no blank flash);
 *   tab/scroll still prefer own memory, else settle at status / 0
 * - else empty (hard)
 */
export function takeOverviewMountPaint(
  sessionId: string,
  parentId: string | undefined,
): OverviewSessionUi | null {
  const own = bySession.get(sessionId)
  if (own?.loaded?.status != null) return own

  const prevId = lastVisited
  if (prevId === undefined || prevId === sessionId) return own ?? null
  const prev = bySession.get(prevId)
  if (prev?.loaded?.status == null) return own ?? null
  if (!isSessionLineageHop(prevId, prev.parentId, sessionId, parentId)) return own ?? null

  const tab = own?.tab ?? 'status'
  const scrollByTab = own?.scrollByTab ?? {}
  return pack(tab, scrollByTab, parentId, prev.loaded)
}
