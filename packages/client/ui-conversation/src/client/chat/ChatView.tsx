// ChatView: the default conversation view — one stable keyed parent list over
// final business Nodes, plus paging, pending steering and bottom-follow.
// Each row dispatches through 'conversation.chat.node'; ui-tool owns the
// tool-call renderer and its recursive root/subcall composition. A Host
// open-path refusal from the injected opener is an in-page dialog here.
//
// Scroll: when nested under `[data-conversation-scroll]` (active conversation
// column), that host is the scrollport and this view is flow content; when
// mounted alone (unit tests), `.scroll` owns overflow. Bottom-follow and
// prepend anchoring always target the resolved scrollport.
//
// Render economics: order changes only when rows enter, leave or move. Each
// ChatNodeSeat subscribes to one Node key, so Assistant deltas and Tool
// lifecycle updates replace only their own row without remounting it.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import type {
  ChatSnapshot,
  PendingSubmission,
  QueuedMessage,
} from '@xrkseek/client-runtime/client'
import {
  formatAttachmentSummary,
  normalizeAttachmentId,
} from '@xrkseek/client-runtime/client'
import type { ImageAttachmentRef } from '@xrkseek/xrk-attachment'
import { Button, IconChevronDownOutlineRegular, Modal } from '@xrkseek/client-ui-primitives'
import type { ChatViewSlotProps, RenderMessageFiles, RenderMessageImages } from '../contract/slots.ts'
import { PendingSteeringBubble, PendingSubmissionBubble, previewAttachmentsOf } from './MessageItem.tsx'
import {
  collectUserShapedSeqs, durableSteerPending, groupPendingByChrome,
  earliestAgentWorkId, hasLiveAgentWork, hasOpenTurn, isHistoricClosedTurn, isTurnInFlight,
  latestTurnNumber, rowSteerIdentity, runningTurnStartTime,
  turnsAreSettled,
} from './pending-input-chrome.ts'
import { isAtFlowFloor, readingLineY, resolveActiveTurn } from './active-turn.ts'
import { shouldShowFlowWaiting, hasActiveTurnSurface } from './flow-waiting.ts'
import { shouldFollowContentGrowth } from './follow-growth.ts'
import { ChatNodeSeat, UserSendFlow } from './ChatNodeSeat.tsx'
import { ProcessGroupSeat } from './ProcessGroupSeat.tsx'
import { flowEntries } from '../conversation-nodes/process-groups.ts'
import { presentationPolicyFor } from '../conversation-nodes/presentation-policy.ts'
import { ResubmitConfirm } from './ResubmitConfirm.tsx'
import {
  completeResubmitConfirm,
  getResubmitIntent,
  subscribeResubmitIntent,
} from './resubmit-intent.ts'
import { TurnNavigator } from './TurnNavigator.tsx'
import { mergeTurnRailItems, slideTurnRailWindow, type TurnRailItem } from './turn-rail-items.ts'
import { formatRunDuration } from './message-chrome.ts'
import { openerKeysFromRail, userRoundLabelKind } from './round-label.ts'
import css from './ChatView.module.css'

const FOLLOW_THRESHOLD = 24
/** Idle waiting copy pool (`turnStatus.0` …); one pick stays for the whole turn. */
const TURN_STATUS_PHRASES = [
  'turnStatus.0', 'turnStatus.1', 'turnStatus.2', 'turnStatus.3',
  'turnStatus.4', 'turnStatus.5', 'turnStatus.6', 'turnStatus.7',
  'turnStatus.8', 'turnStatus.9', 'turnStatus.10', 'turnStatus.11',
  'turnStatus.12', 'turnStatus.13', 'turnStatus.14', 'turnStatus.15',
] as const

/** Active column host when present; otherwise the view-local scroller. */
function scrollerOf(from: HTMLElement): HTMLElement {
  return (from.closest('[data-conversation-scroll]')) ?? from
}

/**
 * Overlay soft-keyboard band (mirrors ui-layout visual-viewport-keyboard;
 * value import across plugins is forbidden — keep the pure math local).
 */
function keyboardInsetPx(
  innerHeight: number,
  visualHeight: number,
  visualOffsetTop: number,
): number {
  const covered = innerHeight - visualHeight - visualOffsetTop
  if (!Number.isFinite(covered) || covered <= 0) return 0
  return Math.round(covered)
}

/** Smallest host turn cited by the turn-outline projection, if it is an array. */
function outlineEarliestTurn(outline: unknown): number | null {
  if (!Array.isArray(outline)) return null
  let earliest: number | null = null
  for (const raw of outline) {
    if (typeof raw !== 'object' || raw === null) continue
    const turn = (raw as { readonly turn?: unknown }).turn
    if (typeof turn !== 'number' || !Number.isSafeInteger(turn)) continue
    if (earliest === null || turn < earliest) earliest = turn
  }
  return earliest
}

interface PagingAnchor {
  /** Stable node/call identity, independent of boundary-spanning group keys. */
  key: string
  /** Row top relative to the scrollport after the latest user scroll. */
  top: number
}

/** Find an already-rendered settled row by its anchor identity.
 *
 * The attribute selector resolves in native code, matching how the e2e suite
 * locates the same rows. The old loop built a `NodeList` over every rendered
 * row and compared in JS, and `realizePendingJump` runs this from a layout
 * effect on every frame while a jump is armed — on a long transcript that was
 * an O(rows) JS scan per frame. `key` is always a `node:`/`call:` identity, so
 * quoting the value only needs `\` and `"`. */
function anchorElement(list: HTMLElement, key: string): HTMLElement | null {
  const quoted = key.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
  return list.querySelector<HTMLElement>(`[data-chat-anchor-key="${quoted}"]`)
}

/**
 * Turn owning the row at a scrollport line. Scroll frames are hot, so this
 * hit-tests the line first and falls back to one row scan when layout cannot
 * answer (jsdom, pre-paint); neither path queries per navigation item.
 * @param list - the ChatView list element.
 * @param line - viewport y of the reading line.
 * @returns the Turn number, or null when no loaded row covers the line.
 */
function turnAtLine(list: HTMLElement, line: number): number | null {
  const content = list.getBoundingClientRect()
  if (typeof document.elementsFromPoint === 'function' && content.width > 0) {
    for (const element of document.elementsFromPoint(content.left + content.width / 2, line)) {
      const row = element instanceof HTMLElement ? element.closest<HTMLElement>('[data-chat-turn]') : null
      const turn = Number(row?.dataset.chatTurn)
      if (row !== null && list.contains(row) && Number.isSafeInteger(turn)) return turn
    }
  }
  let found: number | null = null
  for (const row of list.querySelectorAll<HTMLElement>('[data-chat-turn]')) {
    if (row.getBoundingClientRect().top > line) break
    const turn = Number(row.dataset.chatTurn)
    if (Number.isSafeInteger(turn)) found = turn
  }
  return found
}

/** Row position in scrollport coordinates (viewport-independent). */
function flowTop(row: HTMLElement, scrollport: HTMLElement): number {
  return row.getBoundingClientRect().top - scrollport.getBoundingClientRect().top
}

/** Select a visible stable node/call identity, falling back only when layout
 * has not exposed a visible box yet. `viewport` lets the caller reuse the one
 * scrollport rect it already had to read instead of forcing a second layout. */
function pagingAnchor(
  list: HTMLElement,
  scrollport: HTMLElement,
  viewport: DOMRect = scrollport.getBoundingClientRect(),
): HTMLElement | null {
  const composer = scrollport.querySelector<HTMLElement>('[data-composer-seat]')
  const visibleBottom = composer?.getBoundingClientRect().top ?? viewport.bottom
  // One probe on the reading line (viewport.top + 1), where the reader's eye
  // enters the flow — the same single point DSH uses. Four points (top/third/
  // half/bottom) were tried to tolerate gaps between rows, but every probe is
  // a hit test that forces layout, and a miss still fell through to the sweep
  // below, so on a long transcript the scroll handler paid 4 hit tests plus a
  // full row scan per frame.
  if (typeof document.elementsFromPoint === 'function' && visibleBottom > viewport.top) {
    const content = list.getBoundingClientRect()
    const left = Math.max(viewport.left, content.left)
    const right = Math.min(viewport.right, content.right)
    const x = left + Math.max(0, right - left) / 2
    for (const element of document.elementsFromPoint(x, viewport.top + 1)) {
      const row = element instanceof HTMLElement
        ? element.closest<HTMLElement>('[data-chat-anchor-key]')
        : null
      if (row !== null && list.contains(row)) return row
    }
  }
  // Rows are laid out in document order, so their tops increase monotonically:
  // binary-search the first row whose bottom clears the reading line instead of
  // measuring every row. jsdom reports a zero rect for everything, which walks
  // to the end and returns `rows[0]` — exactly what the old full sweep returned.
  // `:not(:empty)` matches DSH's capturePosition sweep and this view's own
  // `.flowItem:empty { display: none }` rule: an empty keyed row still sits in
  // the DOM with a zero rect, and naming it as the anchor would restore the
  // reader to a row nothing paints.
  // Skip folded process bodies (`hidden="until-found"`) like DSH's probe.
  const rows = list.querySelectorAll<HTMLElement>(
    '[data-chat-anchor-key]:not(:empty):not([hidden]):not([hidden] *)',
  )
  let low = 0
  let high = rows.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (rows.item(middle).getBoundingClientRect().bottom > viewport.top) high = middle
    else low = middle + 1
  }
  const candidate = rows[low]
  if (candidate !== undefined && candidate.getBoundingClientRect().top < visibleBottom) {
    return candidate
  }
  return rows[0] ?? null
}

type ChatScrollPosition = NonNullable<ReturnType<ChatViewSlotProps['chatScroll']['read']>>

/** The row the last probe resolved under the reading edge. */
interface AnchorProbe {
  row: HTMLElement | null
}

/** Capture a reflow-resistant reader position from the current rendered window.
 *
 * A scroll tick usually stays inside the row that already straddles the
 * reading line, so the probe is remembered and reused: re-running the hit test
 * plus the monotonic row scan resolved the same element, and on a long
 * transcript that was a hit test, a `querySelector`, and four forced layout
 * reads per frame. Only a tick that crosses a row boundary re-probes. */
function scrollPosition(
  list: HTMLElement,
  scrollport: HTMLElement,
  probe?: AnchorProbe,
): ChatScrollPosition | null {
  const viewport = scrollport.getBoundingClientRect()
  const held = probe?.row ?? null
  if (held !== null && held.isConnected && list.contains(held)) {
    const heldKey = held.dataset.chatAnchorKey
    const rect = held.getBoundingClientRect()
    if (heldKey !== undefined && rect.bottom > viewport.top + 1 && rect.top <= viewport.top + 1) {
      return { anchorKey: heldKey, anchorTop: rect.top - viewport.top, scrollTop: scrollport.scrollTop }
    }
  }
  const row = pagingAnchor(list, scrollport, viewport)
  const anchorKey = row?.dataset.chatAnchorKey
  if (row === null || anchorKey === undefined) {
    if (probe !== undefined) probe.row = null
    return null
  }
  if (probe !== undefined) probe.row = row
  return {
    anchorKey,
    anchorTop: row.getBoundingClientRect().top - viewport.top,
    scrollTop: scrollport.scrollTop,
  }
}

/** First anchorable row in document order — the paging anchor.
 *
 * A prepend shifts every row by the same delta, so holding the first row still
 * keeps the reader's place with one selector and one rect, no hit test and no
 * row scan. `scrollPosition` keeps the viewport probe because a saved reading
 * position has to name the row the reader sees, not the top of the loaded
 * window; the two used to share one probe, which made paging pay for the
 * viewport semantics it never needed. */
function documentOrderAnchor(list: HTMLElement, scrollport: HTMLElement): PagingAnchor | null {
  const row = list.querySelector<HTMLElement>(
    '[data-chat-anchor-key]:not(:empty):not([hidden]):not([hidden] *)',
  )
  const key = row?.dataset.chatAnchorKey
  if (row === null || key === undefined) return null
  return { key, top: flowTop(row, scrollport) }
}

/** Host/OS refusal text for the file-open dialog; empty throws keep a locale fallback. */
function openFailureMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : String(error)
  return message === '' ? fallback : message
}

/**
 * Prompt-RPC identities already rendered by durable user/steering nodes.
 * Host queue rows are not observed here: queued echoes live in QueueDock, and
 * steering echoes merge with the Host next-step row until the durable node lands
 * (DSH pendingInputs handoff).
 */
function messageEchoIds(data: {
  readonly source?: { readonly kind?: unknown; readonly rpcId?: unknown } | null
  readonly rpcIds?: unknown
  readonly messageId?: unknown
}): readonly string[] {
  const ids: string[] = []
  const source = data.source
  if (source?.kind === 'user' && typeof source.rpcId === 'string' && source.rpcId.length > 0) {
    ids.push(source.rpcId)
  }
  if (Array.isArray(data.rpcIds)) {
    for (const id of data.rpcIds) {
      if (typeof id === 'string' && id.length > 0) ids.push(id)
    }
  }
  if (typeof data.messageId === 'string' && data.messageId.length > 0) ids.push(data.messageId)
  return ids
}

function observedRpcIds(
  order: readonly string[],
  nodes: ChatSnapshot['nodes'],
): ReadonlySet<string> {
  const observed = new Set<string>()
  for (const key of order) {
    const node = nodes.get(key)
    if (node === undefined || (node.kind !== 'user' && node.kind !== 'steering')) continue
    for (const id of messageEchoIds(node.data as Parameters<typeof messageEchoIds>[0])) {
      observed.add(id)
    }
  }
  return observed
}

function humanBubbleText(data: { readonly content?: readonly unknown[] }): string {
  const parts: string[] = []
  for (const block of data.content ?? []) {
    if (block !== null && typeof block === 'object' && 'type' in block
      && (block as { type: string }).type === 'text'
      && typeof (block as { text?: unknown }).text === 'string') {
      parts.push((block as { text: string }).text)
    }
  }
  return parts.join('')
}

/** Inbox can stamp the opener as `steering` when inject already started a step. */
/** Text of the earliest user opener in the window.
 *
 * Lifted out of `isOpenerDuplicateSteer`: that predicate used to rescan every
 * row on every call, and four `filter`/`some` passes over the transcript called
 * it once per row — O(n²) on every render, including every keystroke in the
 * composer. The opener is now found once per render and compared in O(1). */
function earliestOpenerText(
  rows: readonly { readonly kind: string; readonly data?: { readonly seq?: number; readonly time?: number; readonly content?: readonly unknown[] } }[],
): string {
  let earliestId = Number.POSITIVE_INFINITY
  let openerText = ''
  for (const row of rows) {
    if (row.kind !== 'user') continue
    const id = rowSteerIdentity(row.data)
    if (id === undefined) continue
    if (id < earliestId) {
      earliestId = id
      openerText = humanBubbleText(row.data ?? {})
    }
  }
  return openerText
}

function isOpenerDuplicateSteer(
  node: ReturnType<ChatSnapshot['nodes']['get']>,
  openerText: string,
): boolean {
  if (node === undefined || node.kind !== 'steering') return false
  const text = humanBubbleText(node.data as { readonly content?: readonly unknown[] })
  return text !== '' && openerText !== '' && openerText === text
}

function promptRpcId(node: ReturnType<ChatSnapshot['nodes']['get']>): string | undefined {
  if (node === undefined || node.kind !== 'user') return undefined
  const source = node.data.source
  if (source === null || typeof source !== 'object' || !('rpcId' in source)) return undefined
  const rpc = (source as { rpcId?: unknown }).rpcId
  return typeof rpc === 'string' && rpc.length > 0 ? rpc : undefined
}

function hostTurnOf(node: NonNullable<ReturnType<ChatSnapshot['nodes']['get']>>): number | undefined {
  const location = node.location
  return location.kind === 'turn' || location.kind === 'step' ? location.turn.turn : undefined
}

function isLiveSteerRow(
  node: ReturnType<ChatSnapshot['nodes']['get']>,
  live: boolean,
  userSeqs: readonly number[],
  /**
   * `earliestAgentWorkId` for the window, not the rows: this predicate runs
   * once per row in the flow-tail scan, and re-deriving "did work land before
   * me" from the rows each time is what made that scan quadratic.
   */
  earliestAgentWork: number,
  latestTurn: number | null,
): boolean {
  if (node === undefined || (node.kind !== 'user' && node.kind !== 'steering')) return false
  const id = rowSteerIdentity(node.data as { readonly seq?: number; readonly time?: number })
  if (id === undefined) return false
  return durableSteerPending(
    node.kind, node.location, id, live, userSeqs,
    earliestAgentWork < id, latestTurn,
  )
}

/** One flow-tail pending input: local echo or Host-authoritative steering row. */
type PendingChatInput =
  | { readonly kind: 'echo'; readonly submission: PendingSubmission; readonly itemId?: QueuedMessage['id'] }
  | { readonly kind: 'steer'; readonly item: QueuedMessage; readonly submission?: PendingSubmission }

function pendingWithdrawId(input: PendingChatInput): QueuedMessage['id'] | undefined {
  return input.kind === 'steer' ? input.item.id : input.itemId
}

function pendingInputContent(input: PendingChatInput): readonly unknown[] {
  if (input.kind === 'echo') {
    return input.submission.text === '' ? [] : [{ type: 'text', text: input.submission.text }]
  }
  return input.item.content
}

/** Shared empty tail so an idle flow keeps one stable `pendingInputs` identity. */
const NO_PENDING_INPUTS: readonly PendingChatInput[] = []

/** ProducedFiles opens the session workspace as `.`. */
function isFolderOpenPath(path: string): boolean {
  return path === '.'
}

function turnStatusPhrase(
  startTime: number | null,
  t: ChatViewSlotProps['t'],
): string {
  const seed = startTime ?? 0
  const index = ((seed % TURN_STATUS_PHRASES.length) + TURN_STATUS_PHRASES.length) % TURN_STATUS_PHRASES.length
  return t(TURN_STATUS_PHRASES[index]!)
}

/** Waiting episodes shorter than this stay label-only (no clock). */
const TURN_STATUS_CLOCK_AFTER_MS = 15_000

/**
 * Wall-clock start of the *current* waiting-line appearance, keyed by
 * sessionId. Lives outside React so a locale-seat change does not reset
 * the digits. Cleared when the line hides (tools / Think / settled) or
 * the view unmounts — the next appearance starts at 0, it does not keep
 * adding through a 10-minute tool loop.
 */
const waitingEpisodeStartedAt = new Map<string, number>()

/** Test seam: wipe every parked waiting-episode clock. */
export function resetWaitingEpisodeClocksForTests(): void {
  waitingEpisodeStartedAt.clear()
}

/**
 * Flow-tail waiting label (`turnStatus.*`). Yields once tools or a streaming
 * partial are the active surface; step gaps and steer waits keep it visible.
 * The phrase stays stable for the open turn; the clock measures this
 * waiting-line appearance from when it became visible (not wall time since
 * `turn/start`, and not the sum of earlier vacuums in the same turn).
 * Whole-turn duration belongs on the settled Ran-for footer.
 *
 * Permanently mounted: every token / step boundary flips `visible`. A
 * non-waiting episode parks the node with `hidden` (no layout slot), and the
 * per-second clock text is written straight into the DOM instead of
 * re-rendering the view. Locale seat changes reformat the digits already on
 * screen without restarting the episode.
 */
function TurnStatus({ visible, startTime, sessionId, t }: {
  /** Whether the flow tail is currently in a waiting vacuum. */
  visible: boolean
  /** Open turn's `turn/start` time — seeds the waiting phrase. */
  startTime: number | null
  /** Session that owns this flow — scopes the parked episode clock. */
  sessionId: string
  /** The owning view's locale seat. */
  t: ChatViewSlotProps['t']
}) {
  const phrase = useMemo(() => turnStatusPhrase(startTime, t), [startTime, t])
  const clockRef = useRef<HTMLSpanElement | null>(null)
  const clockShownRef = useRef(false)
  const elapsedRef = useRef(0)
  const [clockVisible, setClockVisible] = useState(false)
  // The clock only exists once this episode is long, so a label-only wait reads
  // as the bare phrase (its `textContent` feeds copy, tests and the `aria-live`
  // announcement). Once it is up, the per-second digits go straight to the node
  // instead of re-rendering this subtree each second.
  const hideClock = (): void => {
    if (!clockShownRef.current) return
    clockShownRef.current = false
    setClockVisible(false)
  }
  useEffect(() => {
    if (!visible) {
      waitingEpisodeStartedAt.delete(sessionId)
      hideClock()
      return
    }
    let startedAt = waitingEpisodeStartedAt.get(sessionId)
    if (startedAt === undefined) {
      startedAt = Date.now()
      waitingEpisodeStartedAt.set(sessionId, startedAt)
    }
    const tick = (): void => {
      const elapsed = Math.max(0, Date.now() - startedAt)
      elapsedRef.current = elapsed
      if (elapsed < TURN_STATUS_CLOCK_AFTER_MS) {
        hideClock()
        return
      }
      if (!clockShownRef.current) {
        clockShownRef.current = true
        setClockVisible(true)
        return
      }
      const node = clockRef.current
      if (node !== null) node.textContent = formatRunDuration(elapsed, t)
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => { clearInterval(id) }
  }, [visible, sessionId, t])
  useEffect(() => () => {
    waitingEpisodeStartedAt.delete(sessionId)
  }, [sessionId])
  // Fill the node in the same frame it mounts, otherwise the first second shows
  // an empty clock.
  useLayoutEffect(() => {
    const node = clockRef.current
    if (clockVisible && node !== null) node.textContent = formatRunDuration(elapsedRef.current, t)
  }, [clockVisible, t])
  return (
    <div className={css.turnStatus} role="status" aria-live="polite" hidden={!visible}>
      {phrase}
      {clockVisible && <span ref={clockRef} className={css.turnStatusClock} aria-hidden />}
    </div>
  )
}

/**
 * The chat view slot entry: pure component over the composed props; each
 * ordered business Node crosses the keyed renderer seat.
 */
export function ChatView({
  useSession, useSessions, useStore, useProjection, renderSlot, sessionId, openFile, loadOlder, loadThrough, loadImage, inspectCall, chatScroll, forkAt, restoreAt, editAt, regenerateAt, deleteAt, withdrawSteer,
  fileMentions, useToolsDefaultExpanded: _toolsDefaultExpanded, useTranscriptView, t,
}: ChatViewSlotProps) {
  // Work-details mode resolves to capability flags; renderers read the flags,
  // never the mode name (same shape DSH uses, one table row per mode).
  // `toolsDefaultExpanded` opens ToolRow details inside a run only — it must
  // not veto Standard/Compact auto-fold (that switch never promised that).
  const policy = presentationPolicyFor(useTranscriptView(value => value))
  const order = useSession(s => s.chat.order)
  const nodeStore = useSession(s => s.chat.nodes)
  const sessionRunning = useSession(s => s.running)
  const turnNavigationItems = useSession(s => s.chat.navigation.items())
  const turnOutline = useProjection('turnOutline')
  const timeline = useSession(s => s.chat.timeline)
  const railItems = useMemo(() => {
    const windowTurnStarts = timeline.turnOrder.filter(
      turn => timeline.turns.get(turn)?.start !== undefined,
    )
    return mergeTurnRailItems(turnNavigationItems, turnOutline, windowTurnStarts)
  }, [turnNavigationItems, turnOutline, timeline])
  const roundByTurn = useMemo(() => {
    const map = new Map<number, number>()
    for (const item of railItems) map.set(item.turn, item.round)
    return map
  }, [railItems])
  const openerKeyByTurn = useMemo(() => openerKeysFromRail(railItems), [railItems])
  const inbox = useSession(s => s.queue)
  // Stable during token deltas — seats observe node content themselves.
  const runningCallCount = useSession(s => s.runningCalls.length)
  const turnSurfaceActive = useSession(s =>
    hasActiveTurnSurface(s.partial, s.runningCalls.length, s.chat.timeline))
  const runningTurnStart = useSession(s => runningTurnStartTime(s.chat.timeline))
  const turnOpen = useSession(s => hasOpenTurn(s.chat.timeline))
  const turnsSettled = useSession(s => turnsAreSettled(s.chat.timeline))
  const latestTurn = useSession(s => latestTurnNumber(s.chat.timeline))
  // Workspace root off the session list row: path summaries display relative to it.
  const cwd = useSessions(s => s.byId[sessionId]?.cwd)
  const running = useSession(s => s.running)
  const openState = useSession(s => s.openState)
  const openError = useSession(s => s.openError)
  const hasMore = useSession(s => s.hasMore)
  const loadingOlder = useSession(s => s.loadingOlder)
  // The outline's first round is already on screen (its turn/start is in the
  // window). hasMore can still be set for preamble events the chat never
  // paints — don't offer 「加载更早」 there.
  const historyHead = railItems[0]
  const historyAtHead = historyHead?.anchor.kind === 'loaded'
    && timeline.turns.get(historyHead.turn)?.start !== undefined
    && outlineEarliestTurn(turnOutline) === historyHead.turn
  const selectedCallId = useStore(s => s.selection?.callId)
  const [fileOpenError, setFileOpenError] = useState<{ path: string; message: string } | null>(null)
  const [fileOpenBusy, setFileOpenBusy] = useState(false)
  /** Host attachment id open → lightbox (not better-sidebar). */
  const [attachmentPreview, setAttachmentPreview] = useState<ImageAttachmentRef | null>(null)
  const resubmitIntent = useSyncExternalStore(subscribeResubmitIntent, getResubmitIntent, getResubmitIntent)
  const resubmitOpen = resubmitIntent !== null && resubmitIntent.sessionId === sessionId
  // Close/retry must ignore a settlement that started before the latest
  // gesture; otherwise a cancelled in-flight refusal reopens the dialog.
  const fileOpenRequest = useRef(0)

  const requestOpenFile = useCallback((path: string) => {
    const attachmentId = normalizeAttachmentId(path)
    if (attachmentId !== undefined) {
      setFileOpenError(null)
      setFileOpenBusy(false)
      setAttachmentPreview({
        attachmentId: attachmentId as ImageAttachmentRef['attachmentId'],
        mediaType: 'image/png',
        bytes: 1,
        width: 1,
        height: 1,
        name: formatAttachmentSummary(attachmentId),
      })
      return
    }
    const id = ++fileOpenRequest.current
    setFileOpenBusy(true)
    void openFile(path).then(
      () => {
        if (id !== fileOpenRequest.current) return
        setFileOpenError(null)
        setFileOpenBusy(false)
      },
      (error: unknown) => {
        if (id !== fileOpenRequest.current) return
        setFileOpenError({
          path,
          message: openFailureMessage(
            error,
            t(isFolderOpenPath(path) ? 'fileOpen.folderUnknown' : 'fileOpen.unknown'),
          ),
        })
        setFileOpenBusy(false)
      },
    )
  }, [openFile, t])

  const closeAttachmentPreview = useCallback(() => {
    setAttachmentPreview(null)
  }, [])

  const closeFileOpenError = useCallback(() => {
    fileOpenRequest.current += 1
    setFileOpenError(null)
    setFileOpenBusy(false)
  }, [])

  const pendingSteering = useMemo(
    () => inbox.filter(item => item.placement === 'steering'),
    [inbox],
  )
  const pendingSubmissions = useSession(s => s.pendingSubmissions)
  // One pass over the local echoes: `observed` is the durable user/steering
  // rpcIds already painted by their own row, `local` is the transcript-paintable
  // set (queued follow-ups paint in QueueDock), `localIds` keeps every
  // non-queued address, and `previews` keeps every live echo addressable so a
  // Host steering row can borrow its blob previews after its echo retired.
  // Splitting these used to cost two extra filter passes.
  const echoBook = useMemo(() => {
    const local = new Map<string, PendingSubmission>()
    const localIds = new Set<string>()
    const previews = new Map<string, PendingSubmission>()
    if (pendingSubmissions.length === 0) return { local, localIds, previews }
    const observed = observedRpcIds(order, nodeStore)
    for (const submission of pendingSubmissions) {
      if (submission.placement === 'queued') continue
      localIds.add(submission.requestId)
      previews.set(submission.requestId, submission)
      if (!observed.has(submission.requestId)) local.set(submission.requestId, submission)
    }
    return { local, localIds, previews }
  }, [pendingSubmissions, order, nodeStore])
  // A Host steering row outlives its echo: the durable node lands, the echo
  // retires a frame later, and the row is still mirrored meanwhile. Pending
  // bubbles must never resolve a durable ref there — before `user/message`
  // reaches the log that read is unauthorized, and one refusal is pinned as a
  // failed thumbnail until the row leaves. So hold the echo's blob previews for
  // exactly the rows the Host is mirroring; they are dropped with the row.
  const previewMemory = useRef(new Map<string, PendingSubmission>())
  const steeringPreviews = useMemo(() => {
    const memory = previewMemory.current
    const live = new Set<string>()
    for (const item of pendingSteering) {
      const rpcId = item.rpcId
      if (rpcId === undefined) continue
      live.add(rpcId)
      const echo = echoBook.previews.get(rpcId)
      if (echo !== undefined) memory.set(rpcId, echo)
    }
    for (const key of [...memory.keys()]) if (!live.has(key)) memory.delete(key)
    return memory
  }, [pendingSteering, echoBook])
  // Merge Host next-step with local echoes by rpcId so one bubble stays mounted
  // through admit→claim→durable (prefer echo; steer echoes keep 「插队中」).
  // Purity matters here: `echoBook` is cached across renders, so consumption is
  // recorded in a local `consumed` set instead of deleting from the shared map.
  const pendingInputs = useMemo((): readonly PendingChatInput[] => {
    const { local, localIds } = echoBook
    if (local.size === 0 && localIds.size === 0 && pendingSteering.length === 0) {
      return NO_PENDING_INPUTS
    }
    const observed = observedRpcIds(order, nodeStore)
    const consumed = new Set<string>()
    const pending: PendingChatInput[] = []
    for (const item of pendingSteering) {
      const rpcId = item.rpcId
      if (rpcId !== undefined && observed.has(rpcId)) continue
      if (rpcId === undefined) {
        pending.push({ kind: 'steer', item })
        continue
      }
      const submission = local.get(rpcId)
      if (submission !== undefined) {
        consumed.add(rpcId)
        pending.push({ kind: 'echo', submission, itemId: item.id })
        continue
      }
      if (localIds.has(rpcId)) continue
      const preview = steeringPreviews.get(rpcId)
      pending.push({
        kind: 'steer',
        item,
        ...(preview === undefined ? {} : { submission: preview }),
      })
    }
    for (const [rpcId, submission] of local) {
      if (consumed.has(rpcId)) continue
      // Retire only when this submission's rpcId is on a durable row. Text /
      // time equality wrongly hides the echo once an inject user/message
      // lands before the human durable bubble.
      if (observed.has(rpcId)) continue
      pending.push({ kind: 'echo', submission })
    }
    return pending
  }, [pendingSteering, echoBook, steeringPreviews, order, nodeStore])
  // 插队中 follows Host `running` (same latch as Stop). Draining tools after
  // cancel must not keep follow-ups painted as 插队.
  const agentLive = running
  // NOTE: none of this may be memoised on `nodeStore`/`order`. The node store
  // is a mutable class instance whose identity never changes, and the builder
  // deliberately reuses `order` arrays when their contents match, so both are
  // stable across content updates — a memo keyed on them would keep rendering
  // the first transcript it ever saw. The work below is cheap now that each
  // pass is O(n) instead of O(n²); correctness beats a cache that cannot see
  // the update.
  const chatRows = [...nodeStore.values()]
  // The earliest opener is found once; `isOpenerDuplicateSteer` used to rescan
  // every row for it on every call, which is what made these passes quadratic.
  const openerText = earliestOpenerText(chatRows)
  const userSeqs = collectUserShapedSeqs(
    chatRows.filter(node => !isOpenerDuplicateSteer(node, openerText)),
    latestTurn,
  )
  const hasUserOpener = chatRows.some(node =>
    node.kind === 'user'
    && !isOpenerDuplicateSteer(node, openerText)
    && !isHistoricClosedTurn(node.location, latestTurn))
  // Ctrl+Enter flush of 排队 is 插队 once a real user opener exists and the
  // agent is live. Steering-only leftovers (closed-parent subagent notices)
  // must not latch the pending chrome. Prior 轮次 assistant/tool rows are
  // not this flight — otherwise a new send flashes 「发送中」.
  const hasAgentWork = hasLiveAgentWork(chatRows, latestTurn)
  const steerPendingChrome = agentLive && (hasUserOpener || hasAgentWork)
  // Every `isLiveSteerRow` below asks whether agent work landed before its row.
  // One pass answers all of them: the predicate compares against this id
  // instead of rescanning the window per row.
  const earliestAgentWork = earliestAgentWorkId(chatRows, latestTurn)
  // Turn body (opener + assistant so far) → waiting → 插队 cluster.
  let trailingSteerAt = order.length
  for (let i = order.length - 1; i >= 0; i--) {
    const node = nodeStore.get(order[i]!)
    // `steerPendingChrome`, not raw `running`: after every turn has closed the
    // Host may still report running while tools drain, and a late steer (or a
    // subagent notice past the last turn end) must not keep the trailing
    // cluster alive. Same latch the pending-input chrome below already uses.
    if (isLiveSteerRow(node, steerPendingChrome, userSeqs, earliestAgentWork, latestTurn)) {
      trailingSteerAt = i
      continue
    }
    break
  }
  const bodyOrder = order.slice(0, trailingSteerAt).filter(key => (
    !isOpenerDuplicateSteer(nodeStore.get(key), openerText)
  ))
  const trailingSteerOrder = order.slice(trailingSteerAt).filter(key => (
    !isOpenerDuplicateSteer(nodeStore.get(key), openerText)
  ))
  let skippedTrailingRunningStep = false
  let lastDurableKey: string | null = null
  for (let i = order.length - 1; i >= 0; i--) {
    const key = order[i]!
    const node = nodeStore.get(key)
    if (node === undefined) continue
    if (isLiveSteerRow(node, steerPendingChrome, userSeqs, earliestAgentWork, latestTurn)) continue
    if (node.kind === 'assistant-step' && (node.data as { status?: string }).status === 'running') {
      skippedTrailingRunningStep = true
      continue
    }
    lastDurableKey = key
    break
  }
  const lastDurable = lastDurableKey === null ? undefined : nodeStore.get(lastDurableKey)
  const nextSendRound = railItems.length === 0
    ? 1
    : (railItems[railItems.length - 1]?.round ?? railItems.length) + 1
  const pendingGroups = useMemo(
    () => groupPendingByChrome(pendingInputs, (input) => {
      // 排队 never paints here. Host FIFO-claim promotes a flushed 排队
      // echo to `transcript` — while this turn is still in flight that
      // follow-up is 插队, not a next-turn send above waiting.
      if (input.kind === 'echo' && input.submission.placement !== 'steering') {
        return steerPendingChrome && isTurnInFlight(agentLive, turnOpen, turnsSettled)
          ? 'steer'
          : 'send'
      }
      return steerPendingChrome ? 'steer' : 'send'
    }),
    [pendingInputs, steerPendingChrome, agentLive, turnOpen, turnsSettled],
  )
  // First-turn injects land before the human user/message. When the window
  // still has no context rows, keep a same-height header under the echo so
  // the bubble does not drop when the log write lands. Later turns often
  // skip inject — do not paint a phantom row there.
  const renderMessageImages = useCallback<RenderMessageImages>(
    owner => renderSlot('conversation.message.images', { ...owner, loadImage }),
    [loadImage, renderSlot],
  )
  const renderMessageFiles = useCallback<RenderMessageFiles>(
    owner => renderSlot('conversation.message.files', owner),
    [renderSlot],
  )

  const listRef = useRef<HTMLDivElement | null>(null)
  const columnRef = useRef<HTMLDivElement | null>(null)
  const atBottomRef = useRef(true)
  const [atBottom, setAtBottom] = useState(true)
  const [activeTurn, setActiveTurn] = useState<number | null>(
    () => turnNavigationItems.at(-1)?.turn ?? null,
  )
  const railWindow = useMemo(
    () => slideTurnRailWindow(railItems, activeTurn),
    [railItems, activeTurn],
  )
  /** Last position delivered or written on the main thread. */
  const observedTopRef = useRef(0)
  /** Paging anchor: semantic row/position at click, updated by reader scrolls
   * while the request is pending and restored after the prepend lands. */
  const anchorRef = useRef<PagingAnchor | null>(null)
  /** Last row resolved under the reading edge; reused while it still straddles it. */
  const anchorProbeRef = useRef<AnchorProbe>({ row: null })
  /** Unloaded-rail jump waiting for its turn/start seq to enter the window. */
  const pendingJumpRef = useRef<{ turn: number; seq: number } | null>(null)
  const jumpRepageHeadRef = useRef<number | null>(null)
  const jumpLandedRef = useRef(false)
  const [busyJumpTurn, setBusyJumpTurn] = useState<number | null>(null)
  /** Bumped when a loadThrough completion settles, after its last page's commit. */
  const [jumpSettleTick, setJumpSettleTick] = useState(0)
  const firstSeqRef = useRef<number | null>(null)
  const openedRef = useRef(false)
  const lastKeyRef = useRef<string | null>(null)
  const lastSteeringIdRef = useRef<string | null>(null)
  /** Flow tip signature — follow-scroll only when this moves, never on a
   *  scroll-driven at-bottom chrome re-render (which would snap inertial
   *  scrolls the rest of the way to the floor). */
  const followSigRef = useRef<string | null>(null)

  const firstKey = order[0]
  const firstSeq = firstKey === undefined ? null : nodeStore.get(firstKey)?.anchorSeq ?? null
  const lastKey = order.at(-1) ?? null
  const lastNode = lastKey === null ? undefined : nodeStore.get(lastKey)
  const pendingSendCount = pendingGroups.reduce(
    (n, group) => n + (group.chrome === 'send' ? group.items.length : 0),
    0,
  )
  const showFlowWaiting = shouldShowFlowWaiting({
    running,
    pendingSendCount,
    tailKind: lastDurable?.kind,
    turnSurfaceActive,
    runningCallCount,
    skippedTrailingRunningStep,
    turnsSettled,
  })
  const lastPending = pendingInputs[pendingInputs.length - 1]
  const lastSteeringId = lastPending === undefined
    ? null
    : lastPending.kind === 'steer'
      ? (lastPending.item.rpcId ?? lastPending.item.id)
      : lastPending.submission.requestId
  const lastSubmissionId = lastPending?.kind === 'echo' ? lastPending.submission.requestId : null
  const followSig = `${openState}:${firstSeq}:${lastKey}:${order.length}:${running ? 1 : 0}:${lastSteeringId ?? ''}:${lastSubmissionId ?? ''}`

  const syncActiveTurn = useCallback((): void => {
    const local = listRef.current
    if (local === null || railItems.length === 0) {
      setActiveTurn(null)
      return
    }
    const el = scrollerOf(local)
    const next = resolveActiveTurn({
      readingTurn: turnAtLine(local, readingLineY(el)),
      offeredTurns: railItems.map(item => item.turn),
      loadedTurns: railItems.flatMap(item => (
        item.anchor.kind === 'loaded' ? [item.turn] : []
      )),
      atFlowFloor: isAtFlowFloor(local, el, FOLLOW_THRESHOLD),
    })
    setActiveTurn(current => current === next ? current : next)
  }, [railItems])

  const activeTurnRef = useRef<(() => void) | null>(null)
  const activeFrameRef = useRef<number | null>(null)
  const scheduleActiveTurn = useCallback((): void => {
    if (activeFrameRef.current !== null) return
    if (typeof requestAnimationFrame === 'undefined') {
      syncActiveTurn()
      return
    }
    activeFrameRef.current = requestAnimationFrame(() => {
      activeFrameRef.current = null
      syncActiveTurn()
    })
  }, [syncActiveTurn])

  useEffect(() => () => {
    if (activeFrameRef.current !== null && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(activeFrameRef.current)
    }
  }, [])

  activeTurnRef.current = scheduleActiveTurn

  useLayoutEffect(() => {
    scheduleActiveTurn()
  }, [scheduleActiveTurn])

  const lastScrollHeightRef = useRef(0)

  const toBottom = (el: HTMLElement): void => {
    anchorRef.current = null
    el.scrollTop = el.scrollHeight
    observedTopRef.current = el.scrollTop
    lastScrollHeightRef.current = el.scrollHeight
    atBottomRef.current = true
    setAtBottom(true)
    chatScroll.save(null)
    setActiveTurn(railItems.at(-1)?.turn ?? null)
  }

  const landOnRowRef = useRef<(local: HTMLElement, el: HTMLElement, row: HTMLElement, turn: number) => void>(
    () => {},
  )
  landOnRowRef.current = (local, el, row, turn) => {
    el.scrollTop += flowTop(row, el) - 24
    observedTopRef.current = el.scrollTop
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= FOLLOW_THRESHOLD + 1
    atBottomRef.current = isAtBottom
    setAtBottom(isAtBottom)
    setActiveTurn(turn)
    const position = isAtBottom ? null : scrollPosition(local, el, anchorProbeRef.current)
    if (isAtBottom) chatScroll.save(null)
    else if (position !== null) chatScroll.save(position)
  }

  /**
   * Land the pending jump once its Turn has a rendered anchor row; false
   * while it must keep waiting. Mid-jump landings (`settle` false) keep the
   * jump armed; the settling call clears it.
   */
  const realizePendingJump = (local: HTMLElement, el: HTMLElement, settle: boolean): boolean => {
    const pending = pendingJumpRef.current
    if (pending === null) return true
    const item = railItems.find(candidate => candidate.turn === pending.turn)
    if (item === undefined || item.anchor.kind !== 'loaded') return false
    const row = anchorElement(local, item.anchor.key)
    if (row === null) return false
    if (settle) {
      pendingJumpRef.current = null
      setBusyJumpTurn(null)
      const held = anchorRef.current
      const landedEarlier = jumpLandedRef.current
      jumpLandedRef.current = false
      anchorRef.current = null
      if (!landedEarlier || held?.key === item.anchor.key) {
        landOnRowRef.current(local, el, row, pending.turn)
      }
      return true
    }
    landOnRowRef.current(local, el, row, pending.turn)
    jumpLandedRef.current = true
    anchorRef.current = { key: item.anchor.key, top: flowTop(row, el) }
    return true
  }

  useLayoutEffect(() => {
    const local = listRef.current
    /* v8 ignore next -- ref-null guard: React attaches the ref before layout effects run. */
    if (local === null) return
    const el = scrollerOf(local)
    // Open completed: jump to the bottom once — unless a scroll position
    // survives from a previous mount (view-tab switch away and back), which
    // is restored instead of snapping the reader back to the floor.
    if (openState === 'open' && !openedRef.current) {
      openedRef.current = true
      const saved = chatScroll.read()
      if (saved === null) {
        toBottom(el)
      } else {
        el.scrollTop = saved.scrollTop
        const row = anchorElement(local, saved.anchorKey)
        if (row !== null) el.scrollTop += flowTop(row, el) - saved.anchorTop
        observedTopRef.current = el.scrollTop
        const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= FOLLOW_THRESHOLD + 1
        atBottomRef.current = isAtBottom
        setAtBottom(isAtBottom)
        const normalized = isAtBottom ? null : scrollPosition(local, el, anchorProbeRef.current)
        if (isAtBottom) chatScroll.save(null)
        else if (normalized !== null) chatScroll.save(normalized)
      }
      firstSeqRef.current = firstSeq
      lastKeyRef.current = lastKey
      lastSteeringIdRef.current = lastSteeringId
      followSigRef.current = followSig
      return
    }
    // Prepend (head seq decreased): preserve the same settled row at the
    // position established by the reader's latest scroll. This excludes
    // unrelated tail/composer growth while the request was in flight.
    if (anchorRef.current !== null && firstSeq !== null && firstSeqRef.current !== null && firstSeq < firstSeqRef.current) {
      const anchor = anchorRef.current
      anchorRef.current = null
      const row = anchorElement(local, anchor.key)
      if (row !== null) el.scrollTop += flowTop(row, el) - anchor.top
      observedTopRef.current = el.scrollTop
      // A jump chunk lands here: scroll to the target once its rows exist;
      // until then keep holding the reader's row for the next chunk.
      if (!realizePendingJump(local, el, false) && row !== null) {
        anchorRef.current = { key: anchor.key, top: flowTop(row, el) }
      }
      firstSeqRef.current = firstSeq
      /* v8 ignore next -- ?? arm: a prepend adds nodes, so the flow list here is never empty. */
      lastKeyRef.current = lastKey
      lastSteeringIdRef.current = lastSteeringId
      followSigRef.current = followSig
      return
    }
    firstSeqRef.current = firstSeq
    // Own words must be visible: a new trailing user node force-scrolls
    // (send lives in the composer, so arrival is detected here, not armed there).
    const appendedUser = lastKey !== lastKeyRef.current && lastNode?.kind === 'user'
    const appendedSteering = lastSteeringId !== null && lastSteeringId !== lastSteeringIdRef.current
    const tipMoved = followSigRef.current !== followSig
    lastKeyRef.current = lastKey
    lastSteeringIdRef.current = lastSteeringId
    followSigRef.current = followSig
    // Follow new flow content while pinned; do NOT re-pin on every render
    // merely because atBottomRef is true (scroll threshold → setState → snap).
    if (appendedUser || appendedSteering || (tipMoved && atBottomRef.current)) {
      toBottom(el)
      return
    }
    // A jump whose target committed outside the anchored-prepend path lands here.
    if (pendingJumpRef.current !== null) realizePendingJump(local, el, false)
  })

  const onScrollRef = useRef(() => {})
  onScrollRef.current = () => {
    const local = listRef.current
    /* v8 ignore next -- ref-null guard: the handler only fires while mounted. */
    if (local === null) return
    const el = scrollerOf(local)
    // Only reader input may make raw scroll geometry change follow ownership:
    // a delivered position that deviates from the observed-top ledger (every
    // programmatic write records itself there synchronously). This covers
    // wheel, touch, scrollbar, and keyboard alike without naming devices.
    // Browser shrink-clamps land exactly on the floor min and delayed
    // programmatic deliveries land on the ledger itself, so both preserve
    // the current ownership state.
    const floor = Math.max(0, el.scrollHeight - el.clientHeight)
    const movedByReader = Math.abs(el.scrollTop - Math.min(observedTopRef.current, floor)) > 0.5
    const isAtBottom = movedByReader
      ? floor - el.scrollTop <= FOLLOW_THRESHOLD + 1
      : atBottomRef.current
    if (!movedByReader && isAtBottom) {
      toBottom(el)
      return
    }
    atBottomRef.current = isAtBottom
    // Avoid re-rendering ChatView on every wheel tick while the follow chrome
    // state is unchanged (Vercel rerender-use-ref-transient-values).
    setAtBottom(current => (current === isAtBottom ? current : isAtBottom))
    const position = isAtBottom ? null : scrollPosition(local, el, anchorProbeRef.current)
    if (isAtBottom) {
      anchorRef.current = null
    } else if (anchorRef.current !== null && position !== null) {
      anchorRef.current = { key: position.anchorKey, top: position.anchorTop }
    }
    // Continuous save (unmount happens after ref detach, so saving there is
    // too late); pinned-to-bottom clears so a remount keeps following.
    // NOTE: this stays synchronous. Deferring it to rAF was tried and breaks
    // the anchored-prepend / remount restore semantics the tests lock down
    // (jsdom has no elementsFromPoint, so the fallback sweep IS the path there).
    if (isAtBottom) chatScroll.save(null)
    else if (position !== null) chatScroll.save(position)
    observedTopRef.current = el.scrollTop
    scheduleActiveTurn()
  }

  // Bind the scroll listener on the resolved scrollport once per mount;
  // reader-input attribution rides the observed-top ledger, not per-device
  // input listeners.
  useEffect(() => {
    const local = listRef.current
    /* v8 ignore next -- ref-null guard: effect runs after the list node commits. */
    if (local === null) return
    const el = scrollerOf(local)
    const onScroll = (): void => { onScrollRef.current() }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScroll)
    }
  }, [])

  // The ref starts null and is assigned every render, so the placeholder
  // initializer a function initial value would need never exists.
  const followRef = useRef<(() => void) | null>(null)
  followRef.current = () => {
    const local = listRef.current
    if (local === null) return
    const el = scrollerOf(local)
    const prevHeight = lastScrollHeightRef.current
    const nextHeight = el.scrollHeight
    const growth = nextHeight - prevHeight
    lastScrollHeightRef.current = nextHeight
    const floor = Math.max(0, el.scrollHeight - el.clientHeight)
    const distance = floor - el.scrollTop
    if (!shouldFollowContentGrowth({
      atBottom: atBottomRef.current,
      distanceFromBottom: distance,
      growth,
      threshold: FOLLOW_THRESHOLD,
    })) return
    el.scrollTop = el.scrollHeight
    observedTopRef.current = el.scrollTop
    if (!atBottomRef.current) {
      atBottomRef.current = true
      setAtBottom(true)
    }
    chatScroll.save(null)
  }
  // Streaming, tool disclosures, and other flow changes resize the column;
  // sticky composer docks (jobs/todo/queue/better-sidebar) resize the seat.
  // Growth near the floor re-pins via shouldFollowContentGrowth. Process-group
  // collapse is CSS-instant and does not animate mid-heights that lift the
  // seat — this observer still re-pins on dock growth.
  useEffect(() => {
    const column = columnRef.current
    const local = listRef.current
    if (column === null || local === null || typeof ResizeObserver === 'undefined') return
    const scrollport = scrollerOf(local)
    lastScrollHeightRef.current = scrollport.scrollHeight
    const composer = scrollport.querySelector<HTMLElement>('[data-composer-seat]')
    const observer = new ResizeObserver(() => {
      followRef.current?.()
      activeTurnRef.current?.()
    })
    observer.observe(column)
    if (composer !== null) observer.observe(composer)
    return () => { observer.disconnect() }
  }, [])

  // Overlay soft keyboard: sticky seat lifts by --xrk-keyboard-inset and the
  // transcript gains matching pad. While the reader is on the floor, re-pin
  // every visualViewport frame so the tip rides up with the keys (Via / Edge
  // packaged WebViews) instead of sitting under the composer.
  useEffect(() => {
    const vv = window.visualViewport
    if (vv === null || vv === undefined) return
    let prevInset = keyboardInsetPx(window.innerHeight, vv.height, vv.offsetTop)
    let raf = 0
    const sync = (): void => {
      raf = 0
      const inset = keyboardInsetPx(window.innerHeight, vv.height, vv.offsetTop)
      const delta = inset - prevInset
      prevInset = inset
      if (delta === 0) return
      const local = listRef.current
      if (local === null) return
      const el = scrollerOf(local)
      const floor = Math.max(0, el.scrollHeight - el.clientHeight)
      const nearFloor = floor - el.scrollTop <= FOLLOW_THRESHOLD + Math.max(0, delta) + 1
      if (!atBottomRef.current && !nearFloor) return
      el.scrollTop = el.scrollHeight
      observedTopRef.current = el.scrollTop
      lastScrollHeightRef.current = el.scrollHeight
      if (!atBottomRef.current) {
        atBottomRef.current = true
        setAtBottom(true)
      }
      chatScroll.save(null)
    }
    const schedule = (): void => {
      if (raf !== 0) return
      raf = window.requestAnimationFrame(sync)
    }
    vv.addEventListener('resize', schedule)
    vv.addEventListener('scroll', schedule)
    window.addEventListener('resize', schedule)
    return () => {
      if (raf !== 0) window.cancelAnimationFrame(raf)
      vv.removeEventListener('resize', schedule)
      vv.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
    }
  }, [chatScroll])

  // A failed/empty page leaves the head unchanged. Once the request leaves
  // its busy state there is no future prepend for the saved anchor to own.
  // (A pending jump re-arms its own anchor in the settle/retry path below.)
  useEffect(() => {
    if (!loadingOlder) anchorRef.current = null
  }, [loadingOlder])

  // Jump settlement: every loadThrough completion bumps the tick after its
  // last page's commit, and a plain pull's loadingOlder flip re-settles a
  // jump it made wait.
  useEffect(() => {
    const pending = pendingJumpRef.current
    const local = listRef.current
    if (pending === null || local === null) return
    const el = scrollerOf(local)
    if (realizePendingJump(local, el, true)) return
    const uncovered = firstSeq === null || firstSeq > pending.seq
    if (uncovered && hasMore) {
      if (loadingOlder) return
      if (jumpRepageHeadRef.current !== firstSeq) {
        jumpRepageHeadRef.current = firstSeq
        const held = pagingAnchor(local, el)
        if (held !== null && held.dataset.chatAnchorKey !== undefined) {
          anchorRef.current = { key: held.dataset.chatAnchorKey, top: flowTop(held, el) }
        }
        void loadThrough(pending.seq).finally(() => { setJumpSettleTick(tick => tick + 1) })
        return
      }
      // Repaged at this head and the window still stops short of the Turn, so
      // the scan below can only match a newer row — landing on the oldest
      // loaded one parks the reader under the paging button and reports
      // success. Drop the spinner but keep the jump armed: a page that moves
      // the head re-enters here and lands for real.
      setBusyJumpTurn(current => (current === null ? current : null))
      return
    }
    let landed = false
    for (const row of local.querySelectorAll<HTMLElement>('[data-chat-turn]')) {
      const turn = Number(row.dataset.chatTurn)
      if (!Number.isSafeInteger(turn) || turn < pending.turn) continue
      landOnRowRef.current(local, el, row, turn)
      landed = true
      break
    }
    // Same for a covered window with no row at or after the Turn: clearing here
    // would retire the jump without ever moving the reader.
    if (!landed) {
      setBusyJumpTurn(current => (current === null ? current : null))
      return
    }
    pendingJumpRef.current = null
    setBusyJumpTurn(null)
  }, [jumpSettleTick])

  // A jump held while a plain pull owned the pager waits in the effect
  // above; the pull's completion is its retry signal.
  useEffect(() => {
    if (!loadingOlder && pendingJumpRef.current !== null) setJumpSettleTick(tick => tick + 1)
  }, [loadingOlder])

  const loadOlderAnchored = (): void => {
    const local = listRef.current
    /* v8 ignore next -- ref-null guard: the paging button renders inside the list tree. */
    if (local !== null) {
      const anchor = documentOrderAnchor(local, scrollerOf(local))
      if (anchor !== null) anchorRef.current = anchor
    }
    loadOlder()
  }

  // Identity feeds the memoized rail; a fresh closure per render would defeat it.
  const navigateToTurn = useCallback((item: TurnRailItem): void => {
    const local = listRef.current
    if (local === null) return
    const el = scrollerOf(local)
    if (item.anchor.kind === 'unloaded') {
      // Jumping into history leaves the live tail: release bottom ownership
      // on the click itself, or a pinned-scroll snap would cancel the jump.
      atBottomRef.current = false
      setAtBottom(false)
      const held = pagingAnchor(local, el)
      if (held !== null && held.dataset.chatAnchorKey !== undefined) {
        anchorRef.current = { key: held.dataset.chatAnchorKey, top: flowTop(held, el) }
      }
      pendingJumpRef.current = { turn: item.turn, seq: item.anchor.seq }
      jumpRepageHeadRef.current = null
      jumpLandedRef.current = false
      setBusyJumpTurn(item.turn)
      void loadThrough(item.anchor.seq).finally(() => { setJumpSettleTick(tick => tick + 1) })
      return
    }
    const row = anchorElement(local, item.anchor.key)
    if (row === null) return
    // A loaded-mark click supersedes any jump still landing.
    pendingJumpRef.current = null
    setBusyJumpTurn(current => (current === null ? current : null))
    landOnRowRef.current(local, el, row, item.turn)
    // A pending older page still has to compensate the prepended height, so
    // navigation moves that anchor to the new position instead of dropping it.
    const landed = loadingOlder ? pagingAnchor(local, el) : null
    anchorRef.current = landed === null || landed.dataset.chatAnchorKey === undefined
      ? null
      : { key: landed.dataset.chatAnchorKey, top: flowTop(landed, el) }
  }, [loadingOlder, loadThrough])

  // Stable identity so a group seat's memo comparison can pass: the seat holds
  // this object as one prop, and a fresh literal per render would re-render
  // every member row of every settled group on unrelated state changes.
  const nodeSeat = useMemo(() => ({
    useSession,
    selectedCallId,
    cwd,
    roundByTurn,
    openerKeyByTurn,
    openFile: requestOpenFile,
    inspectCall,
    forkAt,
    restoreAt,
    editAt,
    regenerateAt,
    deleteAt,
    withdrawSteer,
    loadImage,
    renderMessageImages,
    renderMessageFiles,
    fileMentions,
    renderSlot,
    t,
  }), [
    useSession, selectedCallId, cwd, roundByTurn, openerKeyByTurn, requestOpenFile, inspectCall,
    forkAt, restoreAt, editAt, regenerateAt, deleteAt, withdrawSteer, loadImage,
    renderMessageImages, renderMessageFiles, fileMentions, renderSlot, t,
  ])

  // One list so a send keeps `rpc:<id>` from the echo through the durable
  // user node. A second list would unmount the row when the log write lands.
  // Folds that land above the reader restore the offset themselves. Route the
  // write through here so the observed-top ledger records it; otherwise the
  // scroll handler reads the restored offset as reader input and drops follow.
  const writeFoldScroll = useCallback((scrollport: HTMLElement, top: number): void => {
    scrollport.scrollTop = top
    observedTopRef.current = scrollport.scrollTop
  }, [])
  // A fold moves every row below it, compensated or not, so the persisted
  // reading anchor has to be re-sampled even when `scrollTop` itself stayed
  // put. Reusing the scroll handler keeps the follow latch and the saved
  // position on the same code path they always take.
  const handleFoldSettled = useCallback((): void => { onScrollRef.current() }, [])
  const columnRows: ReactNode[] = []
  const seenSendRpc = new Set<string>()
  // Process runs fold here rather than in the projection: the committed row
  // order already is the projection's output, so grouping is a pure read, and
  // fold state lives in the seat instead of the snapshot.
  for (const entry of flowEntries(bodyOrder, key => nodeStore.get(key), {
    grouping: policy.stepGrouping,
    latestTurn,
    turnClosed: turn => timeline.turns.get(turn)?.status === 'closed',
  })) {
    if (entry.kind === 'group') {
      columnRows.push(
        <ProcessGroupSeat
          key={entry.key}
          entry={entry}
          nodeSeat={nodeSeat}
          t={t}
          foldWhen={policy.foldWhen}
          idleSettled={!sessionRunning && !entry.summary.running}
          detailTitles={policy.detailTitles}
          liveProcessDetail={policy.liveProcessDetail}
          writeScroll={writeFoldScroll}
          onFoldSettled={handleFoldSettled}
        />,
      )
      continue
    }
    const nodeKey = entry.key
    const node = nodeStore.get(nodeKey)
    const rpc = promptRpcId(node)
    if (rpc !== undefined && node?.kind === 'user') {
      seenSendRpc.add(rpc)
      const hostTurn = hostTurnOf(node)
      const round = hostTurn === undefined ? nextSendRound : (roundByTurn.get(hostTurn) ?? nextSendRound)
      const source = node.data.source
      const sourceKind = source !== null && typeof source === 'object' && 'kind' in source
        ? String((source as { kind: unknown }).kind)
        : undefined
      const roundLabel = userRoundLabelKind(nodeKey, hostTurn, openerKeyByTurn, sourceKind) ?? 'turn'
      columnRows.push(
        <UserSendFlow
          key={`rpc:${rpc}`}
          flowKey={`rpc:${rpc}`}
          nodeKey={nodeKey}
          round={round}
          roundLabel={roundLabel}
          {...nodeSeat}
        />,
      )
      continue
    }
    columnRows.push(<ChatNodeSeat key={nodeKey} nodeKey={nodeKey} {...nodeSeat} />)
  }
  for (const group of pendingGroups) {
    if (group.chrome !== 'send') continue
    // A downgraded steer must still paint. It reaches this branch when the turn
    // it was queued against has closed (or Host already admitted it and the
    // chrome latch dropped): the row is no longer 插队, but it is still a
    // pending send the reader typed — dropping it here is what made a queued
    // message vanish from the transcript between two renders.
    const live = group.items.filter((input) => (
      input.kind === 'steer' || !seenSendRpc.has(input.submission.requestId)
    ))
    if (live.length === 0) continue
    // One echo → stable `rpc:` seat through durable handoff. Several idle
    // echoes still stack in one bubble (queue-before-turn), like before.
    const first = live[0]!
    if (live.length === 1 && first.kind === 'echo') {
      const rpc = first.submission.requestId
      columnRows.push(
        <UserSendFlow
          key={`rpc:${rpc}`}
          flowKey={`rpc:${rpc}`}
          submission={first.submission}
          round={nextSendRound}
          {...nodeSeat}
        />,
      )
      continue
    }
    const key = live.map((input) => (
      input.kind === 'echo' ? input.submission.requestId : String(input.item.id)
    )).join('+')
    const content = live.flatMap(pendingInputContent)
    const preview = live.find((input) => (
      input.kind === 'echo' && input.submission.attachments.length > 0
    ))
    const previewAttachments = preview !== undefined && preview.kind === 'echo'
      ? previewAttachmentsOf(preview.submission.attachments)
      : undefined
    columnRows.push(
      <div key={key} className={css.flowItem} data-chat-round={nextSendRound}>
        <div className={css.roundLabel}>{t('chat.turnNavigation.turn', { turn: nextSendRound })}</div>
        <PendingSteeringBubble
          content={content}
          {...(previewAttachments === undefined ? {} : { previewAttachments })}
          renderMessageImages={renderMessageImages}
          renderMessageFiles={renderMessageFiles}
          t={t}
        />
      </div>,
    )
  }

  /** Mid-turn 插队 only — ordinary sends stay in `columnRows` under a stable rpc key. */
  const renderSteerGroup = (group: (typeof pendingGroups)[number]) => {
    if (group.items.length === 1) {
      return group.items.map((input) => {
        const itemId = pendingWithdrawId(input)
        const onWithdraw = itemId === undefined ? undefined : () => { withdrawSteer(itemId) }
        if (input.kind === 'echo') {
          return (
            <PendingSubmissionBubble
              key={input.submission.requestId}
              submission={input.submission}
              steer
              onWithdraw={onWithdraw}
              renderMessageImages={renderMessageImages}
              renderMessageFiles={renderMessageFiles}
              t={t}
            />
          )
        }
        return (
          <PendingSteeringBubble
            key={input.item.id}
            content={input.item.content}
            steer
            onWithdraw={onWithdraw}
            {...(input.submission === undefined
              ? {}
              : { previewAttachments: previewAttachmentsOf(input.submission.attachments) })}
            renderMessageImages={renderMessageImages}
            renderMessageFiles={renderMessageFiles}
            t={t}
          />
        )
      })
    }
    const content = group.items.flatMap(pendingInputContent)
    const preview = group.items.find((input) => input.kind === 'echo' || input.submission !== undefined)
    const previewAttachments = preview === undefined
      ? undefined
      : preview.kind === 'echo'
        ? previewAttachmentsOf(preview.submission.attachments)
        : preview.submission === undefined
          ? undefined
          : previewAttachmentsOf(preview.submission.attachments)
    const key = group.items.map((input) => (
      input.kind === 'echo' ? input.submission.requestId : input.item.id
    )).join('+')
    return [
      <PendingSteeringBubble
        key={key}
        content={content}
        {...(previewAttachments === undefined ? {} : { previewAttachments })}
        renderMessageImages={renderMessageImages}
        renderMessageFiles={renderMessageFiles}
        t={t}
      />,
    ]
  }

  return (
    <div className={css.root}>
      <div ref={listRef} className={css.scroll}>
        <TurnNavigator
          items={railWindow}
          activeTurn={activeTurn}
          busyTurn={busyJumpTurn}
          onNavigate={navigateToTurn}
          t={t}
        />
        <div ref={columnRef} className={css.column} data-chat-flow="">
          {openState === 'loading' && <div className={css.hint}>{t('chat.loadingHistory')}</div>}
          {openState === 'error' && openError !== null && (
            <div className={css.openError}>
              {t('chat.loadError', { message: openError.message, code: openError.code })}
            </div>
          )}
          {hasMore && !historyAtHead && (
            <div className={css.older}>
              <button type="button" disabled={loadingOlder} onClick={loadOlderAnchored}>
                {loadingOlder ? t('loading') : t('chat.loadOlder')}
              </button>
            </div>
          )}
          {columnRows}
          <TurnStatus visible={showFlowWaiting} startTime={runningTurnStart} sessionId={sessionId} t={t} />
          {trailingSteerOrder.map(nodeKey => (
            <ChatNodeSeat key={nodeKey} nodeKey={nodeKey} {...nodeSeat} steer />
          ))}
          {pendingGroups.filter(group => group.chrome === 'steer').flatMap(renderSteerGroup)}
        </div>
        {!atBottom && (
          <div className={css.toBottomSlot}>
            <button
              type="button"
              className={css.toBottom}
              aria-label={t('chat.toBottom')}
              onClick={() => {
                const local = listRef.current
                /* v8 ignore next -- ref-null guard: the button only renders alongside the mounted list. */
                if (local !== null) toBottom(scrollerOf(local))
              }}
            >
              <IconChevronDownOutlineRegular />
            </button>
          </div>
        )}
      </div>
      {attachmentPreview !== null && renderSlot('conversation.attachment.preview', {
        attachment: attachmentPreview,
        loadImage,
        onClose: closeAttachmentPreview,
      })}
      {fileOpenError !== null && (
        <FileOpenErrorDialog
          path={fileOpenError.path}
          message={fileOpenError.message}
          busy={fileOpenBusy}
          onClose={closeFileOpenError}
          onRetry={() => { requestOpenFile(fileOpenError.path) }}
          t={t}
        />
      )}
      <ResubmitConfirm
        open={resubmitOpen}
        title={t(
          resubmitIntent?.kind === 'delete'
            ? 'message.delete.title'
            : resubmitIntent?.kind === 'regenerate'
              ? 'message.regenerate.title'
              : 'message.resubmit.title',
        )}
        description={t(
          resubmitIntent?.kind === 'delete'
            ? 'message.delete.description'
            : resubmitIntent?.kind === 'regenerate'
              ? 'message.regenerate.description'
              : 'message.resubmit.description',
        )}
        cancelLabel={t('message.resubmit.cancel')}
        keepFilesLabel={t('message.resubmit.keepFiles')}
        revertFilesLabel={t('message.resubmit.revertFiles')}
        onChoice={completeResubmitConfirm}
      />
    </div>
  )
}

/** In-page Host open-path refusal: the wire reason plus a retry of the same path. */
function FileOpenErrorDialog({
  path, message, busy, onClose, onRetry, t,
}: {
  path: string
  message: string
  busy: boolean
  onClose: () => void
  onRetry: () => void
  t: ChatViewSlotProps['t']
}) {
  return (
    <Modal
      open
      onClose={onClose}
      closeLabel={t('close')}
      title={t(isFolderOpenPath(path) ? 'fileOpen.folderTitle' : 'fileOpen.title')}
      description={message}
      footer={(
        <>
          <Button variant="outline" className={css.modalAction} onClick={onClose}>{t('cancel')}</Button>
          <Button variant="primary" className={css.modalAction} disabled={busy} onClick={onRetry}>{t('retry')}</Button>
        </>
      )}
    />
  )
}
