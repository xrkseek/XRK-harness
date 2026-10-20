/**
 * Build the alt+←/→ cycle ring: team root then healthy direct children.
 * Empty / singleton → caller must not swallow the key.
 */

import type {
  SessionId,
  SessionListState,
  SubagentAddress,
} from '@xrkseek/client-runtime/client'

/** One hop in the cycle (root uses open-by-id; children prefer catalog address). */
export type SubagentCycleTarget =
  | { readonly kind: 'session'; readonly id: SessionId }
  | { readonly kind: 'subagent'; readonly address: SubagentAddress }

/** Walk `parentId` to the topmost known ancestor (team root). */
export function teamRootId(
  state: Pick<SessionListState, 'byId'>,
  sessionId: SessionId,
): SessionId {
  let id = sessionId
  const seen = new Set<SessionId>()
  for (;;) {
    if (seen.has(id)) return id
    seen.add(id)
    const parent = state.byId[id]?.parentId
    if (parent === undefined || state.byId[parent] === undefined) return id
    id = parent
  }
}

/**
 * Ordered cycle targets for the current session's team.
 * @returns empty when no current session; length 1 when no siblings to switch to.
 */
export function subagentCycleTargets(
  state: Pick<SessionListState, 'byId' | 'subagentsByParent' | 'current'>,
): readonly SubagentCycleTarget[] {
  const current = state.current
  if (current === undefined) return []
  const root = teamRootId(state, current)
  const out: SubagentCycleTarget[] = [{ kind: 'session', id: root }]
  const seen = new Set<SessionId>([root])
  const catalog = state.subagentsByParent[root]
  if (catalog !== undefined) {
    for (const entry of catalog.entries) {
      if (entry.kind !== 'child') continue
      if (seen.has(entry.id)) continue
      seen.add(entry.id)
      out.push({
        kind: 'subagent',
        address: {
          parentSessionId: root,
          childSessionId: entry.id,
          mode: entry.mode,
        },
      })
    }
  }
  for (const id of Object.keys(state.byId) as SessionId[]) {
    if (seen.has(id)) continue
    if (state.byId[id]?.parentId !== root) continue
    seen.add(id)
    out.push({ kind: 'session', id })
  }
  return out
}

/**
 * Next / previous target in the cycle ring.
 * @returns undefined when there is nothing to switch to (caller must not preventDefault).
 */
export function nextSubagentCycleTarget(
  state: Pick<SessionListState, 'byId' | 'subagentsByParent' | 'current'>,
  direction: 1 | -1,
): SubagentCycleTarget | undefined {
  const targets = subagentCycleTargets(state)
  if (targets.length < 2) return undefined
  const current = state.current
  if (current === undefined) return undefined
  let index = targets.findIndex((t) =>
    t.kind === 'session' ? t.id === current : t.address.childSessionId === current)
  if (index < 0) index = 0
  const next = (index + direction + targets.length) % targets.length
  return targets[next]
}
