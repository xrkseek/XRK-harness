/**
 * Per-Session Overview open/closed memory.
 * Width habit stays global (`detailsLast` in the layout store); only the
 * open bit is Session-scoped — open on A must not force-open B.
 * Parent↔child soft hops inherit an open column so delegation does not slam it shut.
 */
const MAX_SESSIONS = 48
const openBySession = new Map<string, boolean>()

/** Test-only reset. */
export function resetDetailsOpenMemoryForTests(): void {
  openBySession.clear()
}

export function rememberDetailsOpen(sessionId: string, open: boolean): void {
  openBySession.delete(sessionId)
  openBySession.set(sessionId, open)
  while (openBySession.size > MAX_SESSIONS) {
    const oldest = openBySession.keys().next().value
    if (oldest === undefined || oldest === sessionId) break
    openBySession.delete(oldest)
  }
}

export function readDetailsOpen(sessionId: string): boolean | undefined {
  return openBySession.get(sessionId)
}

/** Parent↔child (or sibling under the same parent) — keep Overview open across the hop. */
export function isOverviewOpenSoftHop(
  fromId: string,
  fromParentId: string | undefined,
  toId: string,
  toParentId: string | undefined,
): boolean {
  if (fromId === toId) return false
  if (fromParentId === toId || toParentId === fromId) return true
  if (fromParentId !== undefined && fromParentId === toParentId) return true
  return false
}
