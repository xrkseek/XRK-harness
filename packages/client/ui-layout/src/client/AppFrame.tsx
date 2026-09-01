/**
 * Three-column shell frame, registered into the built-in 'root' slot (the web
 * shell renders only 'root'). Owns the grid tracks (sidebar | center |
 * details), the drag handles (pointer capture + rAF throttle), the concession
 * chain (columns.ts), and the child-slot render decisions: the sidebar slot
 * renders HERE with live parameters from the concession solve, and the
 * session-aware occupants render in fixed column positions; strict entries
 * gate themselves on current-session availability while session-maybe
 * entries retain identity. Pure component: everything arrives
 * through the three framework shares — zero cordis or framework imports,
 * zero self-made hooks.
 *
 * Phone viewports (< PHONE_MAX) keep the same React tree but zero the sidebar
 * and details tracks so the conversation is full-bleed; the sidebar becomes a
 * drawer overlay (always wide) and details a full-screen sheet. Narrow tablet
 * viewports (PHONE_MAX..SIDEBAR_AUTO_COLLAPSE) keep the compact rail.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { PropsLocale, PropsRenderSlots, PropsRuntime, PropsStore } from '@xrkseek/client-ui-slots'
import {
  computeColumns, phoneDrawerWidth, resolveShellTracks,
  SIDEBAR_AUTO_COLLAPSE, SIDEBAR_DEFAULT,
} from './columns.ts'
import type { createLayoutStore } from './stores.ts'
import css from './AppFrame.module.css'

/** Full composed props: runtime share + child-slot render share + store share + locale. */
export type AppFrameProps =
  & PropsRuntime<'root'>
  & PropsRenderSlots<'sidebar' | 'conversation' | 'details' | 'shell.overlay'>
  & PropsStore<ReturnType<typeof createLayoutStore>>
  & PropsLocale<'layout'>

/** Center column grid item (session-body building block). */
function CenterColumn(props: { children?: ReactNode; inert?: boolean }) {
  return (
    <div className={css.centerCol} inert={props.inert || undefined}>
      {props.children}
    </div>
  )
}

/** Details column grid item; width 0 keeps the subtree mounted (never unmount on close). */
function DetailsColumn(props: { children?: ReactNode }) {
  return <div className={css.detailsCol}>{props.children}</div>
}

/**
 * One drag handle: pointer capture, rAF-throttled dx reports against the drag-start origin.
 * `side` keys the hover-reveal CSS to the owning column.
 */
function DragHandle(props: { side: 'sidebar' | 'details'; left: number; onStart: () => void; onDrag: (dx: number) => void; onEnd: () => void }) {
  const [dragging, setDragging] = useState(false)
  const origin = useRef(0)
  const latest = useRef(0)
  const frame = useRef<number | null>(null)
  const callbacks = useRef({ onStart: props.onStart, onDrag: props.onDrag, onEnd: props.onEnd })
  callbacks.current = { onStart: props.onStart, onDrag: props.onDrag, onEnd: props.onEnd }

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    origin.current = e.clientX
    latest.current = e.clientX
    callbacks.current.onStart()
    setDragging(true)
  }, [])
  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    latest.current = e.clientX
    frame.current ??= requestAnimationFrame(() => {
      frame.current = null
      callbacks.current.onDrag(latest.current - origin.current)
    })
  }, [])
  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    e.currentTarget.releasePointerCapture(e.pointerId)
    if (frame.current !== null) { cancelAnimationFrame(frame.current); frame.current = null }
    callbacks.current.onDrag(latest.current - origin.current)
    setDragging(false)
    callbacks.current.onEnd()
  }, [])

  return (
    <div
      className={css.handle}
      style={{ left: props.left }}
      data-side={props.side}
      data-dragging={dragging || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    />
  )
}

/** The three-column frame (see module doc). */
export function AppFrame({
  useStore,
  useSessions,
  actions,
  renderSlot,
  t,
}: AppFrameProps) {
  const panels = useStore(s => s)
  const currentSession = useSessions(s => s.current)
  const detailsSession = useSessions((s) => {
    const current = s.current
    return current !== undefined && s.byId[current]?.blank === false ? current : undefined
  })
  const frameRef = useRef<HTMLDivElement | null>(null)
  const [viewport, setViewport] = useState(() => window.innerWidth)

  const lastSession = useRef(detailsSession)
  useLayoutEffect(() => {
    if (detailsSession === undefined) return
    if (lastSession.current !== undefined && lastSession.current !== detailsSession) {
      actions.closeDetails()
    }
    lastSession.current = detailsSession
  }, [actions, detailsSession])

  // Track the frame's own box (not the window): rAF-throttled ResizeObserver.
  useEffect(() => {
    const el = frameRef.current
    /* v8 ignore next -- the ref is always attached by effect time: the frame div renders unconditionally. */
    if (el === null) return
    let raf: number | null = null
    const observer = new ResizeObserver(() => {
      raf ??= requestAnimationFrame(() => {
        raf = null
        const width = el.getBoundingClientRect().width
        if (width > 0) setViewport(width)
      })
    })
    observer.observe(el)
    return () => {
      observer.disconnect()
      if (raf !== null) cancelAnimationFrame(raf)
    }
  }, [])

  // Narrow viewports auto-collapse the sidebar; the store mirror keeps
  // toggleSidebar's semantics right (narrow toggles flip the manual
  // re-expand override, stores.ts). Collapsed is decided here, so the
  // solver stays breakpoint-free: a narrow re-expand passes the preference
  // (or the default when the wide preference is closed) and the center
  // absorbs the squeeze. Phone inherits the same narrow flag / override.
  const narrow = viewport < SIDEBAR_AUTO_COLLAPSE
  useEffect(() => { actions.setNarrow(narrow) }, [actions, narrow])
  const sidebarCollapsed = narrow ? !panels.narrowExpanded : panels.sidebar === 0
  const sidebarPreference = sidebarCollapsed
    ? 0
    : panels.sidebar === 0 ? SIDEBAR_DEFAULT : panels.sidebar
  const detailsPreference = detailsSession === undefined ? 0 : panels.details
  const solved = computeColumns(viewport, sidebarPreference, detailsPreference)
  const { tracks: cols, phone } = resolveShellTracks(viewport, solved)
  const drawerWidth = phoneDrawerWidth(viewport)
  const detailsCollapsed = phone ? detailsPreference === 0 : cols.details === 0
  const colsRef = useRef(solved)
  colsRef.current = solved

  // Phone: picking a session (or starting a blank) should tuck the drawer away
  // so the conversation is immediately usable — same expectation as native
  // chat shells. Skip the first paint so a restore into an already-open
  // override does not bounce closed. Collapsed is read from a ref so opening
  // the drawer alone does not re-fire this effect.
  const sidebarCollapsedRef = useRef(sidebarCollapsed)
  sidebarCollapsedRef.current = sidebarCollapsed
  const phoneSessionPrimed = useRef(false)
  useEffect(() => {
    if (!phone) { phoneSessionPrimed.current = false; return }
    if (!phoneSessionPrimed.current) { phoneSessionPrimed.current = true; return }
    if (!sidebarCollapsedRef.current) actions.toggleSidebar()
  }, [actions, currentSession, phone])

  // Phone: opening the details sheet yields the stack to the sheet — a drawer
  // sitting above it would trap the user with no clear path to the sheet.
  useEffect(() => {
    if (!phone || detailsCollapsed || sidebarCollapsed) return
    actions.toggleSidebar()
  }, [actions, detailsCollapsed, phone, sidebarCollapsed])

  // Escape closes the topmost phone overlay (drawer first, then details).
  useEffect(() => {
    if (!phone) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      if (!sidebarCollapsed) { actions.toggleSidebar(); return }
      if (!detailsCollapsed) actions.closeDetails()
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [actions, detailsCollapsed, phone, sidebarCollapsed])

  // The drag base is the rendered width captured at drag start (grabbing a
  // concession-clamped panel must not jump back to the stored preference);
  // it stays frozen for the whole gesture so dx deltas do not compound.
  const sidebarBase = useRef(0)
  const detailsBase = useRef(0)
  // Track-level transitions pause for the whole gesture: eased tracks would
  // detach the column edge from the pointer (AppFrame.module.css).
  const [dragging, setDragging] = useState(false)
  const onDragEnd = useCallback(() => { setDragging(false) }, [])
  const onSidebarStart = useCallback(() => { sidebarBase.current = colsRef.current.sidebar; setDragging(true) }, [])
  const onDetailsStart = useCallback(() => { detailsBase.current = colsRef.current.details; setDragging(true) }, [])
  const onSidebarDrag = useCallback((dx: number) => {
    actions.setSidebar(sidebarBase.current + dx)
  }, [actions])
  const onDetailsDrag = useCallback((dx: number) => {
    actions.setDetails(detailsBase.current - dx)
  }, [actions])

  const drawerOpen = phone && !sidebarCollapsed
  const menuRef = useRef<HTMLButtonElement | null>(null)
  const drawerWasOpen = useRef(false)
  const swipeOrigin = useRef<{ x: number; y: number; pointerId: number } | null>(null)
  const swipeTracking = useRef(false)
  const [drawerShift, setDrawerShift] = useState(0)

  // Return focus to the floating open control only when that control is
  // actually shown (drawer closed AND details sheet closed). Opening details
  // also collapses the drawer; focusing a missing menu would be a no-op at
  // best and a confusing tab stop at worst.
  useEffect(() => {
    const wasOpen = drawerWasOpen.current
    drawerWasOpen.current = drawerOpen
    if (!wasOpen || drawerOpen || !detailsCollapsed || !phone) return
    const id = requestAnimationFrame(() => { menuRef.current?.focus() })
    return () => { cancelAnimationFrame(id) }
  }, [detailsCollapsed, drawerOpen, phone])

  // Drop any in-flight swipe offset when the drawer closes by another path
  // (Escape, session pick, details sheet) so the next open starts at rest.
  useEffect(() => {
    if (!drawerOpen) setDrawerShift(0)
  }, [drawerOpen])

  // Phone drawer: horizontal drag-left closes (vertical scroll stays free until
  // the gesture resolves as horizontal). Shift is applied via --phone-drawer-shift.
  const onDrawerPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!drawerOpen || e.button !== 0) return
    swipeOrigin.current = { x: e.clientX, y: e.clientY, pointerId: e.pointerId }
    swipeTracking.current = false
  }, [drawerOpen])
  const onDrawerPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const origin = swipeOrigin.current
    if (origin === null || origin.pointerId !== e.pointerId) return
    const dx = e.clientX - origin.x
    const dy = e.clientY - origin.y
    if (!swipeTracking.current) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return
      // Vertical intent → abandon (let the session list scroll).
      if (Math.abs(dy) >= Math.abs(dx) || dx > 0) {
        swipeOrigin.current = null
        return
      }
      swipeTracking.current = true
      e.currentTarget.setPointerCapture(e.pointerId)
    }
    setDrawerShift(Math.min(0, dx))
  }, [])
  const endDrawerSwipe = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const origin = swipeOrigin.current
    if (origin === null || origin.pointerId !== e.pointerId) return
    const tracking = swipeTracking.current
    const shift = tracking ? Math.min(0, e.clientX - origin.x) : 0
    swipeOrigin.current = null
    swipeTracking.current = false
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    setDrawerShift(0)
    if (tracking && shift <= -72) actions.toggleSidebar()
  }, [actions])

  return (
    <div
      ref={frameRef}
      className={css.frame}
      style={{
        // Phone: one in-flow track only. Absolute sidebar/details leave the
        // grid formatting context; with `0 1fr 0` the lone center item
        // auto-places into the first (0px) track and the conversation
        // collapses to width 0 (device emulation looked empty aside from the menu).
        gridTemplateColumns: phone
          ? 'minmax(0, 1fr)'
          : `${cols.sidebar}px minmax(0, 1fr) ${cols.details}px`,
        ...(phone
          ? {
              ['--phone-drawer-width' as string]: `${drawerWidth}px`,
              ['--phone-drawer-shift' as string]: `${drawerShift}px`,
            }
          : null),
      }}
      data-sidebar-collapsed={sidebarCollapsed || undefined}
      data-details-collapsed={detailsCollapsed || undefined}
      data-dragging={dragging || undefined}
      data-phone={phone || undefined}
      data-drawer-swiping={drawerShift !== 0 || undefined}
    >
      <div
        className={css.sidebarCol}
        style={phone ? { width: drawerWidth } : undefined}
        onPointerDown={phone ? onDrawerPointerDown : undefined}
        onPointerMove={phone ? onDrawerPointerMove : undefined}
        onPointerUp={phone ? endDrawerSwipe : undefined}
        onPointerCancel={phone ? endDrawerSwipe : undefined}
        {...(drawerOpen
          ? { role: 'dialog' as const, 'aria-modal': true as const, 'aria-label': t('sidebar.dialog') }
          : {})}
      >
        {/* Render-site slot call with live concession output: a closed
            sidebar keeps the mounted slot at the compact-rail width, and the
            component sees its rendered state as owner params decided here
            (collapsed follows the resolved rail, so a derived auto-collapse
            renders the rail UI too). Phone always feeds the wide drawer. */}
        {renderSlot('sidebar', {
          collapsed: phone ? false : sidebarCollapsed,
          width: phone ? drawerWidth : cols.sidebar,
        })}
      </div>
      <>
        {/* Both column occupants stay at fixed tree positions from first
            paint — no loading gate: a bare status line reads worse than
            the shell's own pending rendering. The conversation
            is session-maybe; the strict details entry naturally renders
            empty while no session is current. */}
        <CenterColumn inert={drawerOpen}>{renderSlot('conversation', {})}</CenterColumn>
        <DetailsColumn>{renderSlot('details', {})}</DetailsColumn>
      </>
      <div className={css.overlayLayer} data-shell-overlay>
        {renderSlot('shell.overlay', {})}
      </div>
      {phone && sidebarCollapsed && detailsCollapsed && (
        <button
          ref={menuRef}
          type="button"
          className={css.phoneMenu}
          aria-label={t('sidebar.open')}
          onClick={() => { actions.toggleSidebar() }}
        >
          <span className={css.phoneMenuIcon} aria-hidden />
        </button>
      )}
      {drawerOpen && (
        <button
          type="button"
          className={css.phoneScrim}
          aria-label={t('sidebar.close')}
          onClick={() => { actions.toggleSidebar() }}
        />
      )}
      {/* The collapsed rail is fixed-width: no resize handle while closed.
          Phone overlays skip drag handles entirely. */}
      {!phone && !sidebarCollapsed && (
        <DragHandle side="sidebar" left={cols.sidebar} onStart={onSidebarStart} onDrag={onSidebarDrag} onEnd={onDragEnd} />
      )}
      {!phone && cols.details > 0 && (
        <DragHandle side="details" left={viewport - cols.details} onStart={onDetailsStart} onDrag={onDetailsDrag} onEnd={onDragEnd} />
      )}
    </div>
  )
}
