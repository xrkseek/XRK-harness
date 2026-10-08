/**
 * Per-Session Overview UI memory (tab · per-tab scroll).
 * Same habit as community sidebar: leave a Session, come back — chrome is where you left it.
 * Shell width / open lives in the layout store (global); this map is Session-scoped content chrome.
 *
 * Face `session.status` paint continuity lives in `overview-load-cache.ts`
 * (stale-while-revalidate). Soft faces still must not read Session inside
 * getSnapshot (React #185) — see `xrk-overview-uses`.
 */
// Leaf import: the client barrel touches `window` (slots); this module is unit-tested in Node,
// and the client lane sits outside the check gate. `lineage-hop.ts` imports nothing and carries
// no identity or state, so the bundle purity gate inlines it exactly (LEAF_PURE_INLINE in
// tsdown.client.ts) instead of demanding the barrel.
import { isSessionLineageHop } from '@xrkseek/client-runtime/src/client/sessions/lineage-hop.ts'

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
): OverviewSessionUi {
  return {
    tab,
    scrollTop: scrollOf(scrollByTab, tab),
    scrollByTab,
    parentId,
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
    ),
  )
}

/**
 * Initial chrome for a Session remount:
 * - own memory wins for tab · scroll
 * - else parent↔child soft handoff of tab/scroll defaults only (never Face payloads)
 * - else empty (hard)
 */
export function takeOverviewMountPaint(
  sessionId: string,
  parentId: string | undefined,
): OverviewSessionUi | null {
  const own = bySession.get(sessionId)
  if (own !== undefined) return own

  const prevId = lastVisited
  if (prevId === undefined || prevId === sessionId) return null
  const prev = bySession.get(prevId)
  if (prev === undefined) return null
  if (!isSessionLineageHop(prevId, prev.parentId, sessionId, parentId)) return null

  // Lineage hop: keep parentId stamp; start on status / scroll 0 (do not steal parent tab).
  return pack('status', {}, parentId)
}
