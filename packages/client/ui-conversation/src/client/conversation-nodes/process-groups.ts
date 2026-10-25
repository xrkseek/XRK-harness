/** Chat-owned process grouping: consecutive tool and reasoning rows inside one
 *  Turn fold behind a single header.
 *
 * DSH keeps this in a stateful `ProcessState` with incremental group identity
 * (`ui-chat/src/client/conversation-nodes/process-groups.ts`); XRK's committed
 * row order already is the projection's output, so the same segmentation is
 * re-derived here as a pure function of that order. Fold state lives in the
 * seat, not here, so re-deriving entries never resets a group the reader
 * opened.
 */

import type { ChatConversationViewNode } from '@xrkseek/client-runtime/client'
import type { ChatNode } from '../contract/chat-nodes.ts'

/** What a process group header summarizes. */
export interface ProcessGroupSummary {
  /** Tool roots in the group, settled or running. */
  readonly tools: number
  /** Reasoning-only Assistant steps in the group. */
  readonly reasoning: number
}

/** One row rendered inside a group body. */
export interface ProcessGroupMember {
  readonly key: string
}

/** One rendered flow entry: a plain row, or a foldable process group. */
export type FlowEntry =
  | { readonly kind: 'node'; readonly key: string }
  | {
    readonly kind: 'group'
    readonly key: string
    readonly turn: number | undefined
    /** Turn status at projection time; a closed Turn folds by default. */
    readonly closed: boolean
    readonly summary: ProcessGroupSummary
    readonly members: readonly ProcessGroupMember[]
  }

/** Split the committed order into plain rows and process groups.
 * @param keys - committed Chat render order, already filtered to visible rows.
 * @param read - node reader for one key.
 * @param options - grouping policy; omitted keeps every run grouped.
 * @returns entries in render order; a group covers one Turn's consecutive
 *   process rows and never spans a Turn boundary.
 */
export function flowEntries(
  keys: readonly string[],
  read: (key: string) => ChatConversationViewNode | undefined,
  options?: {
    /** Where a group may appear; see {@link StepGrouping}. */
    readonly grouping?: 'collapsed' | 'history' | 'none'
    /** Turns at or below this one are history; needed by `history`. */
    readonly latestTurn?: number | null
  },
): FlowEntry[] {
  const grouping = options?.grouping ?? 'collapsed'
  const latestTurn = options?.latestTurn ?? null
  const entries: FlowEntry[] = []
  let pending: { readonly key: string; readonly node: ChatNode }[] = []
  let pendingTurn: number | undefined

  /**
   * Whether this run is allowed to become a group at all.
   *
   * `none` never groups, `history` keeps the Turn the reader is currently in
   * flat (its rows are what he is watching), and `collapsed` groups every run.
   */
  const groups = (turn: number | undefined): boolean => {
    if (grouping === 'none') return false
    if (grouping === 'history') return turn !== latestTurn
    return true
  }

  const flush = (): void => {
    if (pending.length === 0) return
    // One process row reads better inline: a header over a single row hides
    // nothing and adds a second title.
    if (pending.length < 2 || !groups(pendingTurn)) {
      for (const member of pending) entries.push({ kind: 'node', key: member.key })
      pending = []
      pendingTurn = undefined
      return
    }
    let tools = 0
    let reasoning = 0
    for (const member of pending) {
      if (member.node.kind === 'tool-call') tools += 1
      else reasoning += 1
    }
    const first = pending[0]
    if (first === undefined) return
    entries.push({
      kind: 'group',
      // The first member is a stable identity: a prepend or a new tool row at
      // the tail never changes which group already-open rows belong to.
      key: `process:${first.key}`,
      turn: pendingTurn,
      closed: closedTurn(first.node),
      summary: { tools, reasoning },
      members: pending.map(member => ({ key: member.key })),
    })
    pending = []
    pendingTurn = undefined
  }

  for (const key of keys) {
    const node = read(key) as ChatNode | undefined
    if (node === undefined) {
      flush()
      entries.push({ kind: 'node', key })
      continue
    }
    if (!isProcessMember(node)) {
      flush()
      entries.push({ kind: 'node', key })
      continue
    }
    const turn = turnOf(node)
    if (pending.length > 0 && turn !== pendingTurn) flush()
    if (pending.length === 0) pendingTurn = turn
    pending.push({ key, node })
  }
  flush()
  return entries
}

/** Turn owning a rendered row, when the projection resolved one. */
export function turnOf(node: ChatNode): number | undefined {
  const location = node.location
  return location.kind === 'turn' || location.kind === 'step' ? location.turn.turn : undefined
}

/** Whether the owning Turn has closed; rows fall back to open when unresolved. */
export function closedTurn(node: ChatNode): boolean {
  const location = node.location
  return location.kind === 'turn' || location.kind === 'step'
    ? location.turn.status === 'closed'
    : false
}

/** Rows a process group owns.
 *
 * A reply-bearing step stays outside the group: folding it would hide the
 * answer, which is the one row a completed Turn must keep. A reasoning-only
 * step joins the run, so a Turn that thought and called tools folds as one
 * block. */
export function isProcessMember(node: ChatNode): boolean {
  if (node.kind === 'tool-call') return true
  return node.kind === 'assistant-step' && hasReasoning(node) && !hasReply(node)
}

function hasReply(node: ChatNode): boolean {
  return node.kind === 'assistant-step'
    && node.data.blocks.some(block => block.kind === 'text' && block.text.trim() !== '')
}

function hasReasoning(node: ChatNode): boolean {
  return node.kind === 'assistant-step'
    && node.data.blocks.some(block => block.kind === 'reasoning' && block.text.trim() !== '')
}
