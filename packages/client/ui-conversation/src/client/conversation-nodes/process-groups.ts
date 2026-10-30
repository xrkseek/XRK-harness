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

import type { ChatConversationViewNode, ToolCallBlock } from '@xrkseek/client-runtime/client'
import type { ChatNode, ToolChatData } from '../contract/chat-nodes.ts'
import { isSettledTool } from '../contract/chat-nodes.ts'

/** What a process group header summarizes. */
export interface ProcessGroupSummary {
  /** Tool roots in the group, settled or running. */
  readonly tools: number
  /** Reasoning-only Assistant steps in the group. */
  readonly reasoning: number
  /**
   * Tool names in first-seen order (duplicates collapsed).
   * Nameless roots use the placeholder `"tool"` so folded chrome never
   * claims zero steps while members exist.
   */
  readonly toolNames: readonly string[]
  /**
   * One entry per tool call (duplicates kept) for Cursor-style activity
   * counts ("Explored 6 files, 1 search"). Nameless roots use `"tool"`.
   */
  readonly toolCallNames: readonly string[]
  /** Name of the tool still running, when exactly one root is in flight. */
  readonly runningTool: string | undefined
  /** Whether any tool root in the group has not settled. */
  readonly running: boolean
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
    /**
     * Timeline turn status. Preferred over the first member's Location when
     * present: a turn/end can refresh the timeline before every member Node
     * carries a closed Location, and auto-fold must not wait on that race.
     */
    readonly turnClosed?: (turn: number) => boolean
  },
): FlowEntry[] {
  const grouping = options?.grouping ?? 'collapsed'
  const latestTurn = options?.latestTurn ?? null
  const turnClosed = options?.turnClosed
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
    // Group from the first process row. Waiting for a second tool remounted the
    // first row under a new `process:` key and flashed open→fold at the floor.
    if (!groups(pendingTurn)) {
      for (const member of pending) entries.push({ kind: 'node', key: member.key })
      pending = []
      pendingTurn = undefined
      return
    }
    let tools = 0
    let reasoning = 0
    const toolNames: string[] = []
    const toolCallNames: string[] = []
    const seen = new Set<string>()
    let runningTool: string | undefined
    let running = false
    for (const member of pending) {
      if (member.node.kind === 'tool-call') {
        tools += 1
        // Nameless but visible roots still need a label: otherwise the folded
        // activity line falls through to「0 步」while the group clearly ran.
        const name = toolNameOf(member.node) ?? 'tool'
        toolCallNames.push(name)
        if (!seen.has(name)) {
          seen.add(name)
          toolNames.push(name)
        }
        if (toolRunning(member.node)) {
          running = true
          if (runningTool === undefined) runningTool = name
        }
      } else {
        reasoning += 1
      }
    }
    const first = pending[0]
    if (first === undefined) return
    const closed = pendingTurn !== undefined && turnClosed !== undefined
      ? turnClosed(pendingTurn)
      : closedTurn(first.node)
    entries.push({
      kind: 'group',
      // The first member is a stable identity: a prepend or a new tool row at
      // the tail never changes which group already-open rows belong to.
      key: `process:${first.key}`,
      turn: pendingTurn,
      closed,
      summary: { tools, reasoning, toolNames, toolCallNames, runningTool, running },
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

/**
 * Tools that stay as flat transcript rows — never join a process fold.
 *
 * Explore/search/bash fold into「Explored N files…」; deliverables and
 * interactive surfaces must stay visible (present = 交付物; ask / todo /
 * media gen / propose_skill are the same class of "don't hide behind 过程").
 */
export function isStandaloneTranscriptTool(name: string): boolean {
  const key = name
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
  return key === 'present'
    || key === 'ask_user_question'
    || key === 'ask_user'
    || key === 'todo_write'
    || key === 'image_generate'
    || key === 'video_generate'
    || key === 'propose_skill'
}

/** Rows a process group owns.
 *
 * A reply-bearing step stays outside the group: folding it would hide the
 * answer, which is the one row a completed Turn must keep. A reasoning-only
 * step joins the run, so a Turn that thought and called tools folds as one
 * block. Standalone tools (present / ask / …) stay flat. */
export function isProcessMember(node: ChatNode): boolean {
  if (node.kind === 'tool-call') {
    const name = toolNameOf(node)
    if (name !== undefined && isStandaloneTranscriptTool(name)) return false
    return true
  }
  return node.kind === 'assistant-step' && hasReasoning(node) && !hasReply(node)
}

/** Tool display name on a tool-call Chat node, when the root has one. */
export function toolNameOf(node: ChatNode): string | undefined {
  if (node.kind !== 'tool-call') return undefined
  const root = (node.data as ToolChatData | undefined)?.root
  if (root === undefined) return undefined
  return nameOfRoot(root)
}

function toolRunning(node: ChatNode): boolean {
  if (node.kind !== 'tool-call') return false
  const root = (node.data as ToolChatData | undefined)?.root
  if (root === undefined) return false
  return !isSettledTool(root)
}

function nameOfRoot(root: ToolCallBlock): string | undefined {
  if (isSettledTool(root)) {
    const name = root.call?.name
    return name !== undefined && name !== '' ? name : undefined
  }
  return root.name !== '' ? root.name : undefined
}

function hasReply(node: ChatNode): boolean {
  return node.kind === 'assistant-step'
    && node.data.blocks.some(block => block.kind === 'text' && block.text.trim() !== '')
}

function hasReasoning(node: ChatNode): boolean {
  return node.kind === 'assistant-step'
    && node.data.blocks.some(block => block.kind === 'reasoning' && block.text.trim() !== '')
}
