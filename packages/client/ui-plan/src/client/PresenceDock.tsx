/**
 * Compact PresenceBall on the conversation header while Overview is closed.
 * When Overview opens, exit toward the details column, then unmount so the
 * Overview rail can own the ball.
 *
 * Phone: portal an icon-only ball into AppFrame `[data-phone-presence-slot]`
 * (menu | ball | 概况). Tap bounces like desktop — Overview opens only from
 * the gauge. Mid-width desktop (&lt; {@link PRESENCE_ICON_ONLY_ENTER}) collapses
 * the title-row chip to the same icon-only frame so 概况 / jobs stay visible.
 */
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'
import type { InjectFace, PropsLocale, PropsRuntime } from '@xrkseek/client-ui-slots'
import type {} from '@xrkseek/client-ui-conversation/client'
import { PresenceBall, usePresenceEnabled } from './PresenceBall.tsx'
import { useOverviewOpen } from './overview-open.ts'
import {
  readTeamRosterLive,
  subscribeTeamRosterLive,
  teamRosterLiveRevision,
} from '@xrkseek/client-runtime/client'
import { companionChildMemberId, mergeTeamRosterLiveLook } from './team-live-look.ts'
import {
  PRESENCE_DOCK_ENTER_MS,
  PRESENCE_DOCK_EXIT_MS,
} from './presence-handoff.ts'
import {
  EMPTY_PRESENCE_SESSION_CUES,
  type PresenceSessionCues,
} from './presence-session-cues.ts'
import { PENDING_MEMBER_LOOK } from './pending-member-look.ts'
import { loadSessionStatus, type SessionStatusView } from './preview-load.ts'
import { overviewStatusPollMs } from './overview-status-poll.ts'
import css from './PresenceDock.module.css'

const NOOP_SUBSCRIBE = (_listener: () => void): (() => void) => () => {}
const PHONE_ATTR = 'data-xrk-layout-phone'
const PHONE_SLOT = '[data-phone-presence-slot]'

/** Viewport / header width below which the header ball is icon-only (enter). */
export const PRESENCE_ICON_ONLY_ENTER = 960
/** Hysteresis exit for icon-only header ball. */
export const PRESENCE_ICON_ONLY_EXPAND = 1008
/**
 * Conversation header width below which the ball collapses even on a wide
 * window (four-pane squeeze: sidebar + chat + Overview + workbench).
 */
export const PRESENCE_HEADER_ICON_ONLY_ENTER = 720
/** Hysteresis exit for header-width icon-only. */
export const PRESENCE_HEADER_ICON_ONLY_EXPAND = 780

/** Local hysteresis — client plugins must not value-import sibling packages. */
function latchWidthBreakpoint(
  wasActive: boolean,
  width: number,
  enterBelow: number,
  exitBelow: number,
): boolean {
  return wasActive ? width < exitBelow : width < enterBelow
}

const CONVERSATION_HEADER = '[data-conversation-header]'

export { PRESENCE_DOCK_ENTER_MS, PRESENCE_DOCK_EXIT_MS } from './presence-handoff.ts'

/** Injected by ui-plan: session presence cues from the conversation timeline. */
export interface PresenceDockInjected {
  presenceCues: {
    getSnapshot: () => PresenceSessionCues
    subscribe: (listener: () => void) => () => void
  }
  /**
   * @deprecated Header ball no longer opens Overview (bounce only). Kept so
   * older inject faces stay type-compatible.
   */
  openPreview?: () => void
}

export type PresenceDockProps =
  PropsRuntime<'conversation.session.header.utilities'>
  & InjectFace<PresenceDockInjected>
  & PropsLocale<'plan'>

/** idle = visible, no motion; enter/exit = animated; gone = unmounted. */
type DockPhase = 'idle' | 'enter' | 'exit' | 'gone'

function readPhonePresenceSlot(): HTMLElement | null {
  if (typeof document === 'undefined') return null
  if (!document.documentElement.hasAttribute(PHONE_ATTR)) return null
  return document.querySelector(PHONE_SLOT)
}

/** Live phone chrome seat (null on desktop / Overview open). */
function usePhonePresenceSlot(overviewOpen: boolean): HTMLElement | null {
  const [slot, setSlot] = useState<HTMLElement | null>(() => (
    overviewOpen ? null : readPhonePresenceSlot()
  ))

  useEffect(() => {
    if (overviewOpen) {
      setSlot(null)
      return
    }
    let cancelled = false
    const sync = (): void => {
      if (cancelled) return
      const next = readPhonePresenceSlot()
      setSlot((prev) => (prev === next ? prev : next))
    }
    sync()
    const raf = window.requestAnimationFrame(sync)
    const obs = new MutationObserver(sync)
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: [PHONE_ATTR],
    })
    const frameEl = document.querySelector('[data-xrk-frame], [data-dsh-frame]')
    if (frameEl !== null) {
      obs.observe(frameEl, { childList: true, subtree: true })
    }
    return () => {
      cancelled = true
      window.cancelAnimationFrame(raf)
      obs.disconnect()
    }
  }, [overviewOpen])

  return slot
}

/**
 * Collapse the chip to the ball frame when the *window* is mid-width OR the
 * conversation header itself is squeezed (Overview open on a wide desktop).
 */
function useIconOnlyChrome(seatRef: RefObject<HTMLDivElement | null>): boolean {
  const [iconOnly, setIconOnly] = useState(() => (
    typeof window !== 'undefined' && window.innerWidth < PRESENCE_ICON_ONLY_ENTER
  ))
  useEffect(() => {
    let headerRo: ResizeObserver | null = null
    let headerEl: Element | null = null
    let headerWidth = Number.POSITIVE_INFINITY
    // Independent latches — sharing React `prev` across window + header made
    // one axis "exit" while the other still needed icon-only, then flicker.
    let windowActive = typeof window !== 'undefined'
      && window.innerWidth < PRESENCE_ICON_ONLY_ENTER
    let headerActive = false

    const publish = (): void => {
      windowActive = latchWidthBreakpoint(
        windowActive,
        window.innerWidth,
        PRESENCE_ICON_ONLY_ENTER,
        PRESENCE_ICON_ONLY_EXPAND,
      )
      headerActive = latchWidthBreakpoint(
        headerActive,
        headerWidth,
        PRESENCE_HEADER_ICON_ONLY_ENTER,
        PRESENCE_HEADER_ICON_ONLY_EXPAND,
      )
      const next = windowActive || headerActive
      setIconOnly((prev) => (prev === next ? prev : next))
    }

    const syncHeaderTarget = (): void => {
      const next = seatRef.current?.closest(CONVERSATION_HEADER)
        ?? document.querySelector(CONVERSATION_HEADER)
      if (next === headerEl) return
      headerRo?.disconnect()
      headerEl = next
      if (next === null) {
        headerWidth = Number.POSITIVE_INFINITY
        publish()
        return
      }
      headerWidth = (next as HTMLElement).clientWidth
      publish()
      // jsdom / older WebViews may lack ResizeObserver — window resize still
      // re-reads clientWidth via onResize, so the first sync is enough there.
      if (typeof ResizeObserver === 'undefined') return
      headerRo = new ResizeObserver((entries) => {
        const w = entries[0]?.contentRect.width
        if (typeof w !== 'number') return
        headerWidth = w
        publish()
      })
      headerRo.observe(next)
    }

    const onResize = (): void => {
      if (headerEl !== null) {
        headerWidth = (headerEl as HTMLElement).clientWidth
      }
      publish()
    }

    syncHeaderTarget()
    // Seat may mount one frame after the header; re-bind once.
    const raf = window.requestAnimationFrame(syncHeaderTarget)
    window.addEventListener('resize', onResize)
    return () => {
      window.cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
      headerRo?.disconnect()
    }
  }, [seatRef])
  return iconOnly
}

/**
 * Header utilities seat: glanceable emotion ball when Status column is closed.
 */
export function PresenceDock({
  sessionId,
  presenceCues,
  useSessions,
  t,
}: PresenceDockProps) {
  const presenceEnabled = usePresenceEnabled()
  const overviewOpen = useOverviewOpen()
  const phoneSlot = usePhonePresenceSlot(overviewOpen)
  const seatRef = useRef<HTMLDivElement | null>(null)
  const iconOnlyChrome = useIconOnlyChrome(seatRef)
  const iconOnly = phoneSlot !== null || iconOnlyChrome
  const [phase, setPhase] = useState<DockPhase>(() => (overviewOpen ? 'gone' : 'idle'))
  const phaseRef = useRef(phase)
  phaseRef.current = phase
  const [status, setStatus] = useState<SessionStatusView | null>(null)
  const [statusTick, setStatusTick] = useState(0)
  const animTimer = useRef<number | undefined>(undefined)
  const fleetBusyRef = useRef(false)
  const statusLastLatencyMs = useRef(0)
  const statusLoadInFlight = useRef(false)
  const statusLoadQueued = useRef(false)

  const sideline = useSessions((s) => {
    const line = s.byId[sessionId]?.sideline?.trim()
    return line && line.length > 0 ? line : undefined
  })
  const parentRunning = useSessions((s) => s.byId[sessionId]?.running ?? false)
  const childRunning = useSessions((s) => {
    const catalog = s.subagentsByParent[sessionId]
    if (catalog?.entries.some(
      (entry) => entry.kind === 'child' && entry.activity === 'running',
    )) return true
    return Object.values(s.byId).some(
      (row) => row?.origin === 'subagent' && row.parentId === sessionId && row.running,
    )
  })
  const jobsBusy = useSessions((s) => {
    const jobs = s.jobsBySession[sessionId] ?? []
    return jobs.some((job) => job.status === 'running' || job.status === 'stopping')
  })
  const fleetBusy = parentRunning
    || childRunning
    || jobsBusy
    || (status?.delivery.turnActive ?? false)
    || ((status?.delivery.queued ?? 0) > 0)
    || ((status?.delivery.steering ?? 0) > 0)
    || (status?.compaction.phase === 'busy')
    || (status?.subagents.graph.nodes.some((n) => n.activity === 'running') ?? false)
    || (status?.parentDelivery?.turnActive ?? false)
    || ((status?.parentDelivery?.runningSubs ?? 0) > 0)
  fleetBusyRef.current = fleetBusy

  const presenceCue = useSyncExternalStore(
    presenceCues?.subscribe ?? NOOP_SUBSCRIBE,
    () => presenceCues?.getSnapshot() ?? EMPTY_PRESENCE_SESSION_CUES,
    () => EMPTY_PRESENCE_SESSION_CUES,
  )

  /* The header ball (and, on phones, the only ball outside Overview) used to
   * read `status.companionBall` straight — so a Team edit here waited for the
   * next Face poll (5s idle) while the Overview pair updated instantly. */
  const rosterLiveRev = useSyncExternalStore(
    subscribeTeamRosterLive,
    teamRosterLiveRevision,
    () => 0,
  )
  const liveChildLook = (() => {
    const id = companionChildMemberId(status?.delegate)
    return id ? readTeamRosterLive(id)?.appearance : undefined
  })()
  const memberLook = useMemo(
    () => mergeTeamRosterLiveLook(
      status?.companionBall ?? PENDING_MEMBER_LOOK,
      liveChildLook,
    ),
    // `rosterLiveRev` is the wake-up signal: the live map itself is not reactive.
    [status?.companionBall, liveChildLook, rosterLiveRev],
  )

  useEffect(() => {
    if (animTimer.current !== undefined) {
      window.clearTimeout(animTimer.current)
      animTimer.current = undefined
    }
    const current = phaseRef.current
    if (overviewOpen) {
      if (current !== 'gone') {
        setPhase('exit')
        animTimer.current = window.setTimeout(() => {
          animTimer.current = undefined
          setPhase('gone')
        }, PRESENCE_DOCK_EXIT_MS)
      }
    } else if (current === 'gone') {
      setPhase('enter')
      animTimer.current = window.setTimeout(() => {
        animTimer.current = undefined
        setPhase('idle')
      }, PRESENCE_DOCK_ENTER_MS)
    } else if (current === 'exit') {
      setPhase('idle')
    }
    return () => {
      if (animTimer.current !== undefined) {
        window.clearTimeout(animTimer.current)
        animTimer.current = undefined
      }
    }
  }, [overviewOpen])

  const visible = presenceEnabled && phase !== 'gone'

  // Drop stale companionBall immediately on session switch — otherwise the chip
  // keeps the previous seat's look (or paints Settings 老板) until Status returns.
  useEffect(() => {
    setStatus(null)
    setStatusTick((n) => n + 1)
  }, [sessionId])

  useEffect(() => {
    if (!visible || phase === 'exit') return
    setStatusTick((n) => n + 1)
  }, [visible, phase, parentRunning, childRunning, jobsBusy, sessionId])

  useEffect(() => {
    if (!visible || phase === 'exit') return
    let cancelled = false
    let timer: number | undefined
    const schedule = (): void => {
      const delay = overviewStatusPollMs(fleetBusyRef.current, statusLastLatencyMs.current)
      timer = window.setTimeout(() => {
        if (cancelled) return
        setStatusTick((n) => n + 1)
        schedule()
      }, delay)
    }
    schedule()
    return () => {
      cancelled = true
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [visible, phase, sessionId])

  useEffect(() => {
    if (!visible) return
    let alive = true
    if (statusLoadInFlight.current) {
      statusLoadQueued.current = true
      return () => { alive = false }
    }
    statusLoadInFlight.current = true
    const started = performance.now()
    const finish = (next: SessionStatusView | null): void => {
      statusLastLatencyMs.current = performance.now() - started
      statusLoadInFlight.current = false
      if (alive) setStatus(next)
      if (statusLoadQueued.current) {
        statusLoadQueued.current = false
        if (alive) setStatusTick((n) => n + 1)
      }
    }
    void loadSessionStatus(sessionId).then(
      (next) => { finish(next) },
      () => {
        statusLastLatencyMs.current = performance.now() - started
        statusLoadInFlight.current = false
        if (statusLoadQueued.current) {
          statusLoadQueued.current = false
          if (alive) setStatusTick((n) => n + 1)
        }
      },
    )
    return () => { alive = false }
  }, [visible, sessionId, statusTick])

  if (!presenceEnabled) return null

  const seat = (
    <div
      ref={seatRef}
      className={css.seat}
      data-presence-dock=""
      data-phone-dock={phoneSlot ? '' : undefined}
      data-icon-only={iconOnly ? '' : undefined}
      data-phase={phase === 'idle' ? undefined : phase}
      aria-label={phase === 'gone' ? undefined : t('preview.status.presence')}
      aria-hidden={phase === 'exit' || phase === 'gone' || undefined}
    >
      {phase === 'gone'
        ? null
        : (
          <div className={css.dock}>
            <PresenceBall
              sessionId={sessionId}
              {...(status?.presence ? { presence: status.presence } : {})}
              memberLook={memberLook}
              turnActive={
                (status?.delivery.turnActive ?? false)
                || parentRunning
                || (status?.subagents.graph.nodes.some(
                  (n) => n.id === sessionId && n.activity === 'running',
                ) ?? false)
              }
              runningJobs={status?.jobs.filter((j) => j.status === 'running').length ?? 0}
              runningSubs={Math.max(
                status?.subagents.live.filter((s) => s.activity === 'running').length ?? 0,
                childRunning ? 1 : 0,
              )}
              fleetHealth={status?.fleet.health ?? 'ok'}
              queued={status?.delivery.queued ?? 0}
              steering={status?.delivery.steering ?? 0}
              compactionBusy={status?.compaction.phase === 'busy'}
              {...(presenceCue.toolError ? { toolError: presenceCue.toolError } : {})}
              activityAt={Math.max(
                presenceCue.activityAt,
                status?.presence?.updatedAt ?? 0,
              )}
              compact
              density="header"
              {...(sideline ? { captionHint: sideline } : {})}
              t={t as (key: string, params?: Record<string, string>) => string}
              loadingLabel={t('preview.status.presenceLoading')}
              errorLabel={t('preview.status.presenceError')}
              clickHint={t('preview.status.presenceClick')}
            />
          </div>
        )}
    </div>
  )

  if (phoneSlot) return createPortal(seat, phoneSlot)
  return seat
}
