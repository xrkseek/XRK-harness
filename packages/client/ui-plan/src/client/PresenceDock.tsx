/**
 * Compact PresenceBall on the conversation header while Overview is closed.
 * When Overview opens, exit toward the details column, then unmount so the
 * Overview rail can own the ball.
 *
 * Phone: portal an icon-only ball into AppFrame `[data-phone-presence-slot]`
 * (menu | ball | 概况). Tap bounces like desktop — Overview opens only from
 * the gauge. Title-row chip stays for desktop.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import type { InjectFace, PropsLocale, PropsRuntime } from '@xrkseek/client-ui-slots'
import type {} from '@xrkseek/client-ui-conversation/client'
import { PresenceBall, usePresenceEnabled } from './PresenceBall.tsx'
import { useOverviewOpen } from './overview-open.ts'
import {
  PRESENCE_DOCK_ENTER_MS,
  PRESENCE_DOCK_EXIT_MS,
} from './presence-handoff.ts'
import {
  EMPTY_PRESENCE_SESSION_CUES,
  type PresenceSessionCues,
} from './presence-session-cues.ts'
import { loadSessionStatus, type SessionStatusView } from './preview-load.ts'
import { overviewStatusPollMs } from './overview-status-poll.ts'
import css from './PresenceDock.module.css'

const NOOP_SUBSCRIBE = (_listener: () => void): (() => void) => () => {}
const PHONE_ATTR = 'data-xrk-layout-phone'
const PHONE_SLOT = '[data-phone-presence-slot]'

/**
 * Header dock is Overview「被委派方」, never Settings 老板 look.
 * Face `companionBall` usually fills this; until status lands (or reconnect),
 * keep a bare agent default so the chip does not flash Boss 装扮.
 */
const HEADER_AGENT_FALLBACK_LOOK = Object.freeze({
  shape: 'blob',
  color: 'cream',
})

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
    const frameEl = document.querySelector('[data-dsh-frame]')
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
      className={css.seat}
      data-presence-dock=""
      data-phone-dock={phoneSlot ? '' : undefined}
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
              memberLook={status?.companionBall ?? HEADER_AGENT_FALLBACK_LOOK}
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
              {...(sideline && !phoneSlot ? { captionHint: sideline } : {})}
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
