// Resident conversation skeleton. Hero chrome, composer positioning, the
// chain, AND the composer bar (session-maybe slot) stay mounted across
// no-session/session transitions — the bar renders inert via owner props.

import { useCallback, useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import type { WorkspaceId } from '@xrkseek/client-runtime/client'
import type { ConversationSlotProps, InputZone } from '../contract/slots.ts'
import { HeroGlow, HeroShell, WorkspaceChip, workspaceLabel } from './EmptyHero.tsx'
import css from './ConversationRoot.module.css'

/** Full props composed from the slot contract. */
export type ConversationRootProps = ConversationSlotProps

/** localStorage key for the dragged transcript width preference (px). */
const WIDTH_PREF_KEY = 'dsh.conversation.contentWidth'
/** Floor for a dragged content width; matches the layout center-column minimum. */
const CONTENT_MIN = 640
/** Column budget the content must leave free: 88px per side keeps the width
 * handles fully placeable (24px inset + 40px strip + 24px safe zone) — a
 * larger dragged width would push its own handles off the column and leave no
 * way to drag back. */
const CONTENT_EDGE_BUDGET = 176

/** Reads the persisted width preference; durable-storage boundary, so a
 * missing or corrupt value resolves to "no preference".
 * @returns the stored width in px, or null when unset or invalid. */
function readWidthPreference(): number | null {
  const raw = localStorage.getItem(WIDTH_PREF_KEY)
  if (raw === null) return null
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? value : null
}

/** Resolves the content width the CSS axis would show for a column width.
 * @param columnWidth - the conversation column's rendered width in px.
 * @param preference - the dragged preference, or null for the adaptive clamp.
 * @returns the resolved content width in px (mirrors the CSS clamp). */
function resolveContentWidth(columnWidth: number, preference: number | null): number {
  const max = Math.max(CONTENT_MIN, columnWidth - CONTENT_EDGE_BUDGET)
  if (preference !== null) return Math.min(Math.max(preference, CONTENT_MIN), max)
  return Math.max(680, Math.min(columnWidth * 0.64, 920))
}

/** One transcript width handle: pointer capture + rAF-throttled symmetric
 * resize (both sides write the one centered width, so outward travel widens
 * by 2× the pointer distance). pointermove publishes the pointer's Y as a CSS
 * variable so the glow indicator rides it. Mirrors ui-layout AppFrame's
 * DragHandle capture model. */
function WidthHandle(props: {
  side: 'left' | 'right'
  onStart: () => number
  onDrag: (width: number) => void
  onCommit: (width: number) => void
  onEnd: () => void
}) {
  const [dragging, setDragging] = useState(false)
  const draggingRef = useRef(false)
  const base = useRef(0)
  const origin = useRef(0)
  const latest = useRef(0)
  const frame = useRef<number | null>(null)
  const callbacks = useRef(props)
  callbacks.current = props

  const outwardWidth = () => {
    const dx = latest.current - origin.current
    const outward = callbacks.current.side === 'right' ? dx : -dx
    return base.current + outward * 2
  }
  const cancelFrame = () => {
    if (frame.current !== null) { cancelAnimationFrame(frame.current); frame.current = null }
  }
  const finish = (commit: boolean): void => {
    if (!draggingRef.current) return
    cancelFrame()
    if (commit && latest.current !== origin.current) {
      const width = outwardWidth()
      callbacks.current.onDrag(width)
      callbacks.current.onCommit(width)
    }
    draggingRef.current = false
    setDragging(false)
    callbacks.current.onEnd()
  }
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    origin.current = e.clientX
    latest.current = e.clientX
    base.current = callbacks.current.onStart()
    draggingRef.current = true
    setDragging(true)
  }
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    const box = e.currentTarget.getBoundingClientRect()
    e.currentTarget.style.setProperty('--dsh-width-handle-pointer-y', `${e.clientY - box.top}px`)
    if (!draggingRef.current) return
    latest.current = e.clientX
    frame.current ??= requestAnimationFrame(() => {
      frame.current = null
      callbacks.current.onDrag(outwardWidth())
    })
  }
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (!draggingRef.current) return
    latest.current = e.clientX
    finish(true)
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }
  // Capture can drop without a pointerup (leave the window). Defer the
  // abandon so a same-tick pointerup can still commit the travelled width —
  // jsdom and some browsers fire lostpointercapture before pointerup.
  const onPointerCancel = (): void => {
    queueMicrotask(() => { finish(false) })
  }

  return (
    <div
      className={css.widthHandle}
      data-side={props.side}
      data-width-handle={props.side}
      data-dragging={dragging || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onPointerCancel}
    />
  )
}

export function ConversationRoot({
  sessionId, useSession, useSessions, useWorkspaces, useInput, useComposerBlock,
  renderSlot, renderSlotChain, selectWorkspace, t,
}: ConversationRootProps) {
  const openState = useSession(s => s.openState)
  const composerPhase = useSession(s => s.composerPhase)
  const pending = useSession(s => s.pending) ?? []
  const session = useSession(s => s)
  const inputState = useInput(s => s)
  const cwd = useSessions(s => sessionId === undefined ? undefined : s.byId[sessionId]?.cwd)
  const summaryBlank = useSessions(s => sessionId === undefined ? undefined : s.byId[sessionId]?.blank)
  const liveBlank = useSession(s => s.blank)
  const provenBlank = summaryBlank === true || liveBlank === true
  const workspaces = useWorkspaces(s => s)
  // A plugin this package cannot import (ui-model-selection) says this session cannot
  // send; its reason is already localized by whoever raised it.
  const composerBlock = useComposerBlock(block => block)

  const [pickerOpen, setPickerOpen] = useState(false)
  const [pendingWorkspaceId, setPendingWorkspaceId] = useState<WorkspaceId | undefined>()
  const pickerAnchor = useRef<HTMLButtonElement>(null)

  // Publishes the two live measurements floating View chrome reads off the
  // scroll body: the seat's height as --dsh-composer-height, so controls clear
  // the composer as it grows, and the scrollport's own height as
  // --dsh-conversation-viewport-height, so a control can sit in the band the
  // seat leaves visible. Callback ref, not an effect; stable identity prevents
  // observer churn while the first blank session fills the resident body
  // outlet.
  const seatObserver = useRef<ResizeObserver | null>(null)
  const seatResizeRef = useCallback((seat: HTMLDivElement | null): void => {
    seatObserver.current?.disconnect()
    seatObserver.current = null
    const scroller = seat?.parentElement ?? null
    if (seat === null || scroller === null) return
    seatObserver.current = new ResizeObserver(() => {
      scroller.style.setProperty('--dsh-composer-height', `${seat.offsetHeight}px`)
      scroller.style.setProperty(
        '--dsh-conversation-viewport-height',
        `${scroller.clientHeight}px`,
      )
    })
    seatObserver.current.observe(seat)
    seatObserver.current.observe(scroller)
  }, [])

  // Publishes the column's live width as --dsh-conversation-column-width so
  // the shared width axis can adapt (see the .root CSS), and re-clamps a
  // dragged preference against the shrunken column WITHOUT rewriting the
  // stored preference — widening the window restores it (the AppFrame
  // sidebar-drag rule). Same callback-ref pattern as the seat observer.
  const rootEl = useRef<HTMLDivElement | null>(null)
  const rootObserver = useRef<ResizeObserver | null>(null)
  const publishWidths = useCallback((root: HTMLDivElement): void => {
    const column = root.offsetWidth
    root.style.setProperty('--dsh-conversation-column-width', `${column}px`)
    const preference = readWidthPreference()
    if (preference === null) {
      root.style.removeProperty('--dsh-chat-user-width')
    } else {
      root.style.setProperty('--dsh-chat-user-width', `${resolveContentWidth(column, preference)}px`)
    }
  }, [])
  const rootResizeRef = useCallback((root: HTMLDivElement | null): void => {
    rootObserver.current?.disconnect()
    rootObserver.current = null
    rootEl.current = root
    if (root === null) return
    rootObserver.current = new ResizeObserver(() => { publishWidths(root) })
    rootObserver.current.observe(root)
    publishWidths(root)
  }, [publishWidths])

  // Drag plumbing for the two width handles: onStart snapshots the resolved
  // width (grabbing a clamped column must not jump back to the raw stored
  // preference), onDrag publishes only the live clamped style, onCommit
  // persists the width of a gesture that actually travelled, and onEnd
  // republishes from storage — an uncommitted press leaves the stored
  // preference untouched.
  const onHandleStart = useCallback((): number => {
    const root = rootEl.current
    /* v8 ignore next -- handles render inside the root, so the ref is always attached. */
    if (root === null) return 680
    return resolveContentWidth(root.offsetWidth, readWidthPreference())
  }, [])
  const onHandleDrag = useCallback((width: number): void => {
    const root = rootEl.current
    /* v8 ignore next -- handles render inside the root, so the ref is always attached. */
    if (root === null) return
    const clamped = resolveContentWidth(root.offsetWidth, width)
    root.style.setProperty('--dsh-chat-user-width', `${clamped}px`)
  }, [])
  const onHandleCommit = useCallback((width: number): void => {
    const root = rootEl.current
    /* v8 ignore next -- handles render inside the root, so the ref is always attached. */
    if (root === null) return
    localStorage.setItem(WIDTH_PREF_KEY, `${resolveContentWidth(root.offsetWidth, width)}`)
  }, [])
  const onHandleEnd = useCallback((): void => {
    const root = rootEl.current
    if (root !== null) publishWidths(root)
  }, [publishWidths])

  const sessionWorkspace = sessionId === undefined
    ? undefined
    : workspaces.items.find(workspace => workspace.sessionIds.includes(sessionId))
  const pendingWorkspace = workspaces.items.find(
    workspace => workspace.workspaceId === pendingWorkspaceId,
  )

  // Clear the pending pick once the session lands in it, or when the picked
  // workspace disappears from a ready list (deleted from the sidebar).
  useEffect(() => {
    if (pendingWorkspaceId === undefined) return
    if (sessionWorkspace?.workspaceId === pendingWorkspaceId
      || (workspaces.phase === 'ready' && pendingWorkspace === undefined)) {
      setPendingWorkspaceId(undefined)
    }
  }, [pendingWorkspaceId, sessionWorkspace?.workspaceId, workspaces.phase, pendingWorkspace])

  // While a session is still replaying (loading + blank) the hero/docked
  // choice is unknowable — render the composer hidden instead of flashing
  // the centered hero and snapping to the docked bar (or vice versa).
  // Exemption: a session the list summary already proves blank can only
  // land on the hero, so hiding would blank the column for the whole
  // history round-trip (the startup auto-selection flash) for nothing.
  // The exemption is deliberately open-state-wide, not loading-only: a
  // summary-blank session is the hero before its open starts (`cold`) and
  // after one fails (`error`) for the same reason — there is no history.
  const settling = sessionId !== undefined && composerPhase === 'blank' && openState === 'loading'
    && !provenBlank
  // Align with the comment above: summary-blank sessions are hero before open
  // (`cold`), after a failed open (`error`), and once history proves empty
  // (`open`). `settling` only hides the composer — hero chrome must still paint
  // or the column goes fully blank while history replays.
  const hero = sessionId === undefined
    || (composerPhase === 'blank' && (
      openState === 'open'
      || openState === 'cold'
      || openState === 'error'
      || provenBlank
    ))
  const heroChrome = hero || settling
  const zone: InputZone | undefined =
    session === undefined || inputState === undefined ? undefined : { session, input: inputState }

  // The chip is a selector; label resolution walks the flow top-down:
  //   1. a just-picked workspace (pending) → its title;
  //   2. cold start, no session yet → placeholder ("Choose workspace");
  //   3. the blank session's workspace is in the list → its title;
  //   4. list still loading → cwd folder name bridges so the title does not
  //      flash on refresh (empty cwd → placeholder);
  //   5. list ready but no owning workspace (deleted from the sidebar) →
  //      placeholder, never the deleted folder's name via cwd.
  const chipTitle = pendingWorkspace?.title
    ?? (sessionId === undefined
      ? undefined
      : sessionWorkspace?.title
        ?? (workspaces.phase === 'ready' || cwd === undefined || cwd === ''
          ? undefined
          : workspaceLabel(cwd)))

  const heroWorkspaceRow = (
    <div className={css.heroWorkspaceRow}>
      <WorkspaceChip
        buttonRef={pickerAnchor}
        label={chipTitle}
        menuOpen={pickerOpen}
        onClick={() => { setPickerOpen(open => !open) }}
        t={t}
      />
      {renderSlot('conversation.hero.workspace', {
        open: pickerOpen,
        anchorRef: pickerAnchor,
        selectedId: pendingWorkspaceId ?? sessionWorkspace?.workspaceId,
        onPick: (workspaceId) => {
          setPickerOpen(false)
          setPendingWorkspaceId(workspaceId)
          void selectWorkspace(workspaceId).catch(() => {
            setPendingWorkspaceId(current => current === workspaceId ? undefined : current)
          })
        },
        onClose: () => { setPickerOpen(false) },
      })}
      {renderSlot('conversation.hero.agentPreset', {})}
    </div>
  )

  // The placeholder chip ("Choose workspace") and the Workspace-trigger input travel
  // together: no workspace picked yet (cold start, no session at all), or a
  // blank session whose workspace vanished (deleted from the sidebar). The
  // bar is ONE session-maybe slot rendered unconditionally — inert is a prop,
  // not a different tree, so the textarea DOM survives the transition.
  const inert = sessionId === undefined || (heroChrome && chipTitle === undefined)
  // A raised block is the same inert posture with the blocker's own reason:
  // one disabled textarea, never a second tree. The no-workspace state wins
  // when both hold — picking a workspace is the earlier prerequisite.
  const blocked = !inert && composerBlock !== undefined
  const inputBar = renderSlot('conversation.composer.bar', {
    variant: heroChrome ? 'hero' : 'composer',
    ...(inert
      ? {
        disabled: true,
        placeholder: t('placeholder.workspace'),
        workspacePickerOpen: pickerOpen,
        onRequestWorkspace: () => { setPickerOpen(true) },
      }
      : blocked
        // `blocked`, not `disabled`: the bar refuses input either way, but a
        // block keeps the model seat live because choosing a model is how the
        // user clears it.
        ? { blocked: composerBlock, placeholder: composerBlock.reason }
        : heroChrome ? { placeholder: t('placeholder.hero') } : {}),
    overlay: renderSlot('conversation.input.overlay', {}),
    leftItems: zone === undefined ? null : renderSlot('conversation.input.left', zone),
    rightItems: zone === undefined ? null : renderSlot('conversation.input.right', zone),
    // Stats band under the card, inside the bar's width column so both
    // share one constraint (composer.dock = stats-line family).
    footer: !heroChrome && zone !== undefined ? renderSlot('conversation.composer.dock', zone) : null,
  })

  const composerBar = (
    <div className={clsx(css.composerStack, heroChrome && css.composerHero)}>
      {heroChrome && <HeroGlow className={css.heroGlow} />}
      {heroChrome && <HeroShell t={t} renderSlot={renderSlot} />}
      {heroChrome && heroWorkspaceRow}
      {zone !== undefined && renderSlot('conversation.input.dock', zone)}
      {inputBar}
    </div>
  )

  const phase = settling ? 'settling' : hero ? 'hero' : 'active'
  const composer = renderSlotChain(
    'conversation.composer',
    { interactions: pending, session },
    { fallback: composerBar, overlay: true },
  )

  // Sticky wraps the whole chain output (fallback + elected overlay), not
  // only `.composerStack`: overlay:true renders those as siblings, and sticky
  // on the fallback alone would leave Question/Approval panels at the content
  // end off-screen when the user is not pinned to the floor.
  const composerSeat = (
    <div ref={seatResizeRef} className={css.composerSeat} data-composer-seat="">
      {composer}
    </div>
  )

  return (
    <div ref={rootResizeRef} className={css.root} data-phase={phase}>
      {renderSlot('conversation.session.header', {})}
      <div className={css.body}>
        <div className={css.scrollBody} data-conversation-scroll="">
          {renderSlot('conversation.session', {})}
          {composerSeat}
        </div>
        {/* Width handles only while a transcript is on screen; the hero has no
            content column to size. */}
        {phase === 'active' && (['left', 'right'] as const).map(side => (
          <WidthHandle
            key={side}
            side={side}
            onStart={onHandleStart}
            onDrag={onHandleDrag}
            onCommit={onHandleCommit}
            onEnd={onHandleEnd}
          />
        ))}
      </div>
    </div>
  )
}
