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

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type {
  ChatSnapshot,
  ConversationTimelineSnapshot,
  PendingSubmission,
  QueuedMessage,
} from '@xrkseek/client-runtime/client'
import {
  formatAttachmentSummary,
  normalizeAttachmentId,
} from '@xrkseek/client-runtime/client'
import type { ImageAttachmentRef } from '@xrkseek/xrk-attachment'
import { Button, IconChevronDownOutline14, Modal } from '@xrkseek/client-ui-primitives'
import type { ChatViewSlotProps, RenderMessageFiles, RenderMessageImages } from '../contract/slots.ts'
import { PendingSteeringBubble, PendingSubmissionBubble } from './MessageItem.tsx'
import { shouldShowFlowWaiting } from './flow-waiting.ts'
import { shouldFollowContentGrowth } from './follow-growth.ts'
import { ChatNodeSeat } from './ChatNodeSeat.tsx'
import { ResubmitConfirm } from './ResubmitConfirm.tsx'
import {
  completeResubmitConfirm,
  getResubmitIntent,
  subscribeResubmitIntent,
} from './resubmit-intent.ts'
import { TurnNavigator } from './TurnNavigator.tsx'
import { mergeTurnRailItems, type TurnRailItem } from './turn-rail-items.ts'
import { formatRunDuration } from './message-chrome.ts'
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

interface PagingAnchor {
  /** Stable node/call identity, independent of boundary-spanning group keys. */
  key: string
  /** Row top relative to the scrollport after the latest user scroll. */
  top: number
}

/** Find an already-rendered settled row without interpolating a selector. */
function anchorElement(list: HTMLElement, key: string): HTMLElement | null {
  for (const row of list.querySelectorAll<HTMLElement>('[data-chat-anchor-key]')) {
    if (row.dataset.chatAnchorKey === key) return row
  }
  return null
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
 * has not exposed a visible box yet. */
function pagingAnchor(list: HTMLElement, scrollport: HTMLElement): HTMLElement | null {
  const viewport = scrollport.getBoundingClientRect()
  const composer = scrollport.querySelector<HTMLElement>('[data-composer-seat]')
  const visibleBottom = composer?.getBoundingClientRect().top ?? viewport.bottom
  // Scroll events are hot: hit-test a few points through the stretched flow
  // rows before considering the full mounted set. The fallback keeps jsdom
  // and pre-layout states deterministic; a virtualizer naturally bounds it.
  if (typeof document.elementsFromPoint === 'function' && visibleBottom > viewport.top) {
    const content = list.getBoundingClientRect()
    const left = Math.max(viewport.left, content.left)
    const right = Math.min(viewport.right, content.right)
    const x = left + Math.max(0, right - left) / 2
    const height = visibleBottom - viewport.top
    const points = [1, Math.min(32, height / 3), height / 2, Math.max(1, height - 1)]
    for (const offset of points) {
      for (const element of document.elementsFromPoint(x, viewport.top + offset)) {
        const row = element instanceof HTMLElement
          ? element.closest<HTMLElement>('[data-chat-anchor-key]')
          : null
        if (row !== null && list.contains(row)) return row
      }
    }
  }
  const rows = [...list.querySelectorAll<HTMLElement>('[data-chat-anchor-key]')]
  const visibleRows = rows.filter((row) => {
    const rect = row.getBoundingClientRect()
    return rect.bottom > viewport.top && rect.top < visibleBottom
  })
  return visibleRows[0] ?? rows[0] ?? null
}

type ChatScrollPosition = NonNullable<ReturnType<ChatViewSlotProps['chatScroll']['read']>>

/** Capture a reflow-resistant reader position from the current rendered window. */
function scrollPosition(list: HTMLElement, scrollport: HTMLElement): ChatScrollPosition | null {
  const row = pagingAnchor(list, scrollport)
  const anchorKey = row?.dataset.chatAnchorKey
  if (row === null || anchorKey === undefined) return null
  return {
    anchorKey,
    anchorTop: flowTop(row, scrollport),
    scrollTop: scrollport.scrollTop,
  }
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
function observedRpcIds(
  order: readonly string[],
  nodes: ChatSnapshot['nodes'],
): ReadonlySet<string> {
  const observed = new Set<string>()
  for (const key of order) {
    const node = nodes.get(key)
    if (node === undefined || (node.kind !== 'user' && node.kind !== 'steering')) continue
    const source = (node.data as { readonly source?: unknown }).source as
      | { readonly kind?: unknown; readonly rpcId?: unknown }
      | undefined
    if (source?.kind === 'user' && typeof source.rpcId === 'string') observed.add(source.rpcId)
  }
  return observed
}

/** One flow-tail pending input: local echo or Host-authoritative steering row. */
type PendingChatInput =
  | { readonly kind: 'echo'; readonly submission: PendingSubmission }
  | { readonly kind: 'steer'; readonly item: QueuedMessage }

/** Shared empty tail so an idle flow keeps one stable `pendingInputs` identity. */
const NO_PENDING_INPUTS: readonly PendingChatInput[] = []

/** ProducedFiles opens the session workspace as `.`. */
function isFolderOpenPath(path: string): boolean {
  return path === '.'
}

function runningTurnStartTime(timeline: ConversationTimelineSnapshot): number | null {
  let latest: number | null = null
  for (const turn of timeline.turns.values()) {
    if (turn.status === 'open' && turn.start !== undefined) latest = turn.start.time
  }
  return latest
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
 * Flow-tail waiting label (`turnStatus.*`). Yields once tools or a streaming
 * partial are the active surface; step gaps and steer waits keep it visible.
 * The phrase stays stable for the open turn; the clock measures this waiting
 * episode (visible → now), not wall time since `turn/start` — whole-turn
 * duration belongs on the settled Ran-for footer.
 *
 * Permanently mounted: every token / step boundary flips `visible`, and
 * remounting on each flip reset the episode clock, swapped the phrase and
 * re-announced through `aria-live`. A non-waiting episode parks the node with
 * `hidden` (no layout slot, so the column gap is unchanged), and the per-second
 * clock text is written straight into the DOM instead of re-rendering the view.
 * The episode also restarts when the locale seat changes, so the digits are
 * always formatted by the locale actually on screen.
 */
function TurnStatus({ visible, startTime, t }: {
  /** Whether the flow tail is currently in a waiting vacuum. */
  visible: boolean
  /** Open turn's `turn/start` time — seeds the waiting phrase only. */
  startTime: number | null
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
      hideClock()
      return
    }
    const startedAt = Date.now()
    elapsedRef.current = 0
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
  }, [visible, t])
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
  useSession, useSessions, useStore, useProjection, renderSlot, sessionId, openFile, loadOlder, loadThrough, loadImage, inspectCall, chatScroll, forkAt, restoreAt, editAt, deleteAt,
  fileMentions, t,
}: ChatViewSlotProps) {
  const order = useSession(s => s.chat.order)
  const nodeStore = useSession(s => s.chat.nodes)
  const timeline = useSession(s => s.chat.timeline)
  const turnNavigationItems = useSession(s => s.chat.navigation.items())
  const turnOutline = useProjection('turnOutline')
  const railItems = useMemo(
    () => mergeTurnRailItems(turnNavigationItems, turnOutline),
    [turnNavigationItems, turnOutline],
  )
  const inbox = useSession(s => s.queue)
  const partial = useSession(s => s.partial)
  const runningCallCount = useSession(s => s.runningCalls.length)
  // Workspace root off the session list row: path summaries display relative to it.
  const cwd = useSessions(s => s.byId[sessionId]?.cwd)
  const running = useSession(s => s.running)
  const openState = useSession(s => s.openState)
  const openError = useSession(s => s.openError)
  const hasMore = useSession(s => s.hasMore)
  const loadingOlder = useSession(s => s.loadingOlder)
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
  // set (queued follow-ups paint in QueueDock) and `localIds` keeps every
  // non-queued address so a Host steering row can defer to its echo instead of
  // double-painting. Splitting these used to cost two extra filter passes.
  const echoBook = useMemo(() => {
    const local = new Map<string, PendingSubmission>()
    const localIds = new Set<string>()
    if (pendingSubmissions.length === 0) return { local, localIds }
    const observed = observedRpcIds(order, nodeStore)
    for (const submission of pendingSubmissions) {
      if (submission.placement === 'queued') continue
      localIds.add(submission.requestId)
      if (!observed.has(submission.requestId)) local.set(submission.requestId, submission)
    }
    return { local, localIds }
  }, [pendingSubmissions, order, nodeStore])
  // Merge Host next-step with local echoes by rpcId so one bubble stays mounted
  // through admit→claim→durable (prefer echo; steer echoes keep 「插队中」).
  // Purity matters here: `echoBook` is cached across renders, so consumption is
  // recorded in a local `consumed` set instead of deleting from the shared map.
  const pendingInputs = useMemo((): readonly PendingChatInput[] => {
    const { local, localIds } = echoBook
    if (local.size === 0 && localIds.size === 0 && pendingSteering.length === 0) {
      return NO_PENDING_INPUTS
    }
    const consumed = new Set<string>()
    const pending: PendingChatInput[] = []
    for (const item of pendingSteering) {
      const rpcId = item.rpcId
      if (rpcId === undefined) {
        pending.push({ kind: 'steer', item })
        continue
      }
      const submission = local.get(rpcId)
      if (submission !== undefined) {
        consumed.add(rpcId)
        pending.push({ kind: 'echo', submission })
        continue
      }
      if (localIds.has(rpcId)) continue
      pending.push({ kind: 'steer', item })
    }
    for (const [rpcId, submission] of local) {
      if (consumed.has(rpcId)) continue
      pending.push({ kind: 'echo', submission })
    }
    return pending
  }, [pendingSteering, echoBook])
  const renderMessageImages = useCallback<RenderMessageImages>(
    owner => renderSlot('conversation.message.images', { ...owner, loadImage }),
    [loadImage, renderSlot],
  )
  const renderMessageFiles = useCallback<RenderMessageFiles>(
    owner => renderSlot('conversation.message.files', owner),
    [renderSlot],
  )
  const runningTurnStart = useMemo(() => runningTurnStartTime(timeline), [timeline])

  const listRef = useRef<HTMLDivElement | null>(null)
  const columnRef = useRef<HTMLDivElement | null>(null)
  const atBottomRef = useRef(true)
  const [atBottom, setAtBottom] = useState(true)
  const [activeTurn, setActiveTurn] = useState<number | null>(
    () => turnNavigationItems.at(-1)?.turn ?? null,
  )
  /** Last position delivered or written on the main thread. */
  const observedTopRef = useRef(0)
  /** Paging anchor: semantic row/position at click, updated by reader scrolls
   * while the request is pending and restored after the prepend lands. */
  const anchorRef = useRef<PagingAnchor | null>(null)
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
  // Skip the open-step streaming partial when detecting a durable steer tail:
  // fixtures (and production) keep the partial after a steering node in order,
  // which would otherwise hide the post-steer waiting line. Walked backwards
  // with an early exit: the spread+reverse allocated a full copy of the order
  // on every render, which is the dominant garbage source in a long session.
  let lastDurableKey: string | null = null
  for (let i = order.length - 1; i >= 0; i--) {
    const key = order[i]!
    const node = nodeStore.get(key)
    if (node === undefined) continue
    if (node.kind === 'assistant-step' && (node.data as { status?: string }).status === 'running') {
      continue
    }
    lastDurableKey = key
    break
  }
  const lastDurable = lastDurableKey === null ? undefined : nodeStore.get(lastDurableKey)
  const showFlowWaiting = shouldShowFlowWaiting({
    running,
    partial,
    runningCallCount,
    timeline,
    // Steer waits only — transcript echoes must not force the shimmer while
    // Think/tools are live (that was the blue-label flicker on every send).
    pendingSteerCount: pendingInputs.filter((input) => (
      input.kind === 'steer'
      || (input.kind === 'echo' && input.submission.placement === 'steering')
    )).length,
    tailKind: lastDurable?.kind,
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
    const first = turnNavigationItems[0]
    if (local === null || first === undefined) {
      setActiveTurn(null)
      return
    }
    const el = scrollerOf(local)
    const readingLine = el.getBoundingClientRect().top + Math.min(96, el.clientHeight * 0.2)
    const reading = turnAtLine(local, readingLine)
    // No row reaches the line yet: the flow head still owns the mark. Otherwise
    // the row's Turn may be one the rail does not offer (all its nodes hidden),
    // so the newest offered Turn at or above it owns the mark.
    let next = first.turn
    if (reading !== null) {
      for (const item of turnNavigationItems) {
        if (item.turn > reading) break
        next = item.turn
      }
    }
    if (el.scrollHeight - el.scrollTop - el.clientHeight <= FOLLOW_THRESHOLD + 1) {
      next = turnNavigationItems.at(-1)?.turn ?? next
    }
    setActiveTurn(current => current === next ? current : next)
  }, [turnNavigationItems])

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
    setActiveTurn(turnNavigationItems.at(-1)?.turn ?? null)
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
    const position = isAtBottom ? null : scrollPosition(local, el)
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
        const normalized = isAtBottom ? null : scrollPosition(local, el)
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
    const position = isAtBottom ? null : scrollPosition(local, el)
    if (isAtBottom) {
      anchorRef.current = null
    } else if (anchorRef.current !== null && position !== null) {
      anchorRef.current = { key: position.anchorKey, top: position.anchorTop }
    }
    // Continuous save (unmount happens after ref detach, so saving there is
    // too late); pinned-to-bottom clears so a remount keeps following.
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
    const floor = Math.max(0, nextHeight - el.clientHeight)
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
  // the sticky composer (jobs/todo/queue docks) resizes outside it. This
  // observer owns ChatView's dynamic-height follow decisions.
  useEffect(() => {
    const column = columnRef.current
    const local = listRef.current
    if (column === null || local === null || typeof ResizeObserver === 'undefined') return
    const scrollport = scrollerOf(local)
    lastScrollHeightRef.current = scrollport.scrollHeight
    const composer = scrollport.querySelector<HTMLElement>('[data-composer-seat]')
    let followRaf = 0
    const observer = new ResizeObserver(() => {
      followRef.current?.()
      // Second frame: sticky dock height / --dsh-composer-height can settle
      // one paint after the first ResizeObserver callback.
      if (typeof requestAnimationFrame !== 'undefined') {
        if (followRaf !== 0) cancelAnimationFrame(followRaf)
        followRaf = requestAnimationFrame(() => {
          followRaf = 0
          followRef.current?.()
        })
      }
      activeTurnRef.current?.()
    })
    observer.observe(column)
    if (composer !== null) observer.observe(composer)
    return () => {
      if (followRaf !== 0) cancelAnimationFrame(followRaf)
      observer.disconnect()
    }
  }, [])

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
    }
    for (const row of local.querySelectorAll<HTMLElement>('[data-chat-turn]')) {
      const turn = Number(row.dataset.chatTurn)
      if (!Number.isSafeInteger(turn) || turn < pending.turn) continue
      landOnRowRef.current(local, el, row, turn)
      break
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
      const el = scrollerOf(local)
      const row = pagingAnchor(local, el)
      if (row !== null && row.dataset.chatAnchorKey !== undefined) {
        anchorRef.current = {
          key: row.dataset.chatAnchorKey,
          top: flowTop(row, el),
        }
      }
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

  return (
    <div className={css.root}>
      <div ref={listRef} className={css.scroll}>
        <TurnNavigator
          items={railItems}
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
          {hasMore && (
            <div className={css.older}>
              <button type="button" disabled={loadingOlder} onClick={loadOlderAnchored}>
                {loadingOlder ? t('loading') : t('chat.loadOlder')}
              </button>
            </div>
          )}
          {order.map(nodeKey => (
            <ChatNodeSeat
              key={nodeKey}
              nodeKey={nodeKey}
              useSession={useSession}
              selectedCallId={selectedCallId}
              cwd={cwd}
              openFile={requestOpenFile}
              inspectCall={inspectCall}
              forkAt={forkAt}
              restoreAt={restoreAt}
              editAt={editAt}
              deleteAt={deleteAt}
              loadImage={loadImage}
              renderMessageImages={renderMessageImages}
              renderMessageFiles={renderMessageFiles}
              fileMentions={fileMentions}
              renderSlot={renderSlot}
              t={t}
            />
          ))}
          {/* No pending placeholders: questions (ui-user-questions) and approvals
              (ApprovalPanel) both take over the composer, so a flow card would
              double-render the same wait. */}
          {pendingInputs.map((input) => {
            if (input.kind === 'echo') {
              return (
                <PendingSubmissionBubble
                  key={input.submission.requestId}
                  submission={input.submission}
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
                renderMessageImages={renderMessageImages}
                renderMessageFiles={renderMessageFiles}
                t={t}
              />
            )
          })}
          <TurnStatus visible={showFlowWaiting} startTime={runningTurnStart} t={t} />
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
              <IconChevronDownOutline14 />
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
        title={t(resubmitIntent?.kind === 'delete' ? 'message.delete.title' : 'message.resubmit.title')}
        description={t(resubmitIntent?.kind === 'delete' ? 'message.delete.description' : 'message.resubmit.description')}
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
