/**
 * Compact PresenceBall on the conversation header while Overview is closed.
 * When Overview opens, exit toward the details column, then unmount so the
 * Overview rail can own the ball.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@xrkseek/client-ui-slots'
import type {} from '@xrkseek/client-ui-conversation/client'
import { PresenceBall } from './PresenceBall.tsx'
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
import css from './PresenceDock.module.css'

const NOOP_SUBSCRIBE = (_listener: () => void): (() => void) => () => {}

export { PRESENCE_DOCK_ENTER_MS, PRESENCE_DOCK_EXIT_MS } from './presence-handoff.ts'

/** Injected by ui-plan: session presence cues from the conversation timeline. */
export interface PresenceDockInjected {
  presenceCues: {
    getSnapshot: () => PresenceSessionCues
    subscribe: (listener: () => void) => () => void
  }
}

export type PresenceDockProps =
  PropsRuntime<'conversation.session.header.utilities'>
  & InjectFace<PresenceDockInjected>
  & PropsLocale<'plan'>

/** idle = visible, no motion; enter/exit = animated; gone = unmounted. */
type DockPhase = 'idle' | 'enter' | 'exit' | 'gone'

/**
 * Header utilities seat: glanceable emotion ball when Status column is closed.
 */
export function PresenceDock({
  sessionId,
  presenceCues,
  useSessions,
  t,
}: PresenceDockProps) {
  const overviewOpen = useOverviewOpen()
  const [phase, setPhase] = useState<DockPhase>(() => (overviewOpen ? 'gone' : 'idle'))
  const phaseRef = useRef(phase)
  phaseRef.current = phase
  const [status, setStatus] = useState<SessionStatusView | null>(null)
  const [statusTick, setStatusTick] = useState(0)
  const animTimer = useRef<number | undefined>(undefined)

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

  const presenceCue = useSyncExternalStore(
    presenceCues?.subscribe ?? NOOP_SUBSCRIBE,
    () => presenceCues?.getSnapshot() ?? EMPTY_PRESENCE_SESSION_CUES,
    () => EMPTY_PRESENCE_SESSION_CUES,
  )

  // Soft handoff with Overview column open/close (no enter motion on first paint).
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

  const visible = phase !== 'gone'

  useEffect(() => {
    if (!visible || phase === 'exit') return
    setStatusTick((n) => n + 1)
  }, [visible, phase, parentRunning, childRunning, jobsBusy, sessionId])

  useEffect(() => {
    if (!visible || phase === 'exit') return
    const timer = window.setInterval(() => {
      setStatusTick((n) => n + 1)
    }, fleetBusy ? 1_200 : 2_500)
    return () => { window.clearInterval(timer) }
  }, [visible, phase, fleetBusy, sessionId])

  useEffect(() => {
    if (!visible) return
    let alive = true
    void loadSessionStatus(sessionId).then((next) => {
      if (!alive) return
      setStatus(next)
    })
    return () => { alive = false }
  }, [visible, sessionId, statusTick])

  // Width-only seat in the title row; taller chip is absolutely centered so
  // Status / preset pills do not reflow when Overview opens.
  return (
    <div
      className={css.seat}
      data-presence-dock=""
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
              {...(status?.companionBall ? { memberLook: status.companionBall } : {})}
              turnActive={status?.delivery.turnActive ?? parentRunning}
              runningJobs={status?.jobs.filter((j) => j.status === 'running').length ?? 0}
              runningSubs={status?.subagents.live.filter((s) => s.activity === 'running').length ?? 0}
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
              t={t as (key: string, params?: Record<string, string>) => string}
              loadingLabel={t('preview.status.presenceLoading')}
              errorLabel={t('preview.status.presenceError')}
              clickHint={t('preview.status.presenceClick')}
            />
          </div>
        )}
    </div>
  )
}
