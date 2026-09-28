import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type { JobView } from '@xrkseek/client-runtime/client'
import { IconChevronDownOutline14, StateDot, useDismissOnOutsidePointer } from '@xrkseek/client-ui-primitives'
import type { PropsLocale, PropsRuntime, TranslateNS } from '@xrkseek/client-ui-slots'
import { NS } from './locales.ts'
import type {} from '@xrkseek/client-ui-conversation/client'
import { isLiveJob, orderedJobs } from './job-list-shared.ts'
import { JobRows } from './JobRows.tsx'
import { useJobClock } from './use-job-clock.ts'
import css from './JobListAction.module.css'

/** Business actions supplied by the slot registration. */
export interface JobListInjected {
  killJob(jobId: string): void
  backgroundJob(jobId: string): void
}

/** Full props for the session-header background-job action. */
export type JobListActionProps =
  PropsRuntime<'conversation.session.header.actions'> & JobListInjected & PropsLocale<typeof NS>

/** Stable empty list so a session with no jobs keeps one array identity. */
const NO_TASKS: readonly JobView[] = []

/**
 * Session-header entry point for this session's background jobs. It renders
 * nothing at all until the session has at least one job, so an ordinary
 * conversation never grows a control for a capability it is not using.
 * Expand a row to stream Host `jobs.output` into a TerminalBlock.
 */
export function JobListAction({ sessionId, useSessions, killJob, backgroundJob, t }: JobListActionProps) {
  const jobs = useSessions(state => state.jobsBySession[sessionId]) ?? NO_TASKS
  const [open, setOpen] = useState(false)
  const [expandedId, setExpandedId] = useState<string | undefined>(undefined)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const rows = useMemo(() => orderedJobs(jobs), [jobs])
  const liveRows = useMemo(() => rows.filter(isLiveJob), [rows])
  const settledRows = useMemo(() => rows.filter((job) => !isLiveJob(job)), [rows])
  const liveCount = liveRows.length
  const now = useJobClock(open && liveCount > 0)

  useDismissOnOutsidePointer(rootRef, open, setOpen)

  useEffect(() => {
    if (jobs.length === 0 && open) setOpen(false)
  }, [jobs.length, open])

  useEffect(() => {
    if (expandedId !== undefined && !jobs.some((job) => job.id === expandedId)) {
      setExpandedId(undefined)
    }
  }, [jobs, expandedId])

  if (jobs.length === 0) return null

  const countKey = liveCount > 0
    ? (liveCount === 1 ? 'count.live.one' : 'count.live.other')
    : (jobs.length === 1 ? 'count.idle.one' : 'count.idle.other')
  const countLabel = t(countKey, { count: liveCount > 0 ? liveCount : jobs.length })

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Escape' || !open) return
    event.preventDefault()
    if (expandedId !== undefined) {
      setExpandedId(undefined)
      return
    }
    setOpen(false)
    triggerRef.current?.focus()
  }

  const onToggleExpand = (jobId: string): void => {
    setExpandedId((current) => (current === jobId ? undefined : jobId))
  }

  const rowProps = {
    now,
    t: t as TranslateNS<typeof NS>,
    css,
    killJob,
    backgroundJob,
    expandedId,
    onToggleExpand,
  }

  return (
    <div ref={rootRef} className={css.root} onKeyDown={onKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        className={css.trigger}
        aria-expanded={open}
        aria-label={countLabel}
        onClick={() => {
          setOpen((current) => !current)
        }}
      >
        {liveCount > 0 ? <StateDot state="ongoing" className={css.triggerDot} /> : null}
        <span className={css.count}>{countLabel}</span>
        <IconChevronDownOutline14 className={open ? css.triggerOpen : undefined} />
      </button>
      {open
        ? (
          <ul className={css.menu} aria-label={t('list.aria')}>
            {liveRows.length > 0 && settledRows.length > 0
              ? <li className={css.section} role="presentation">{t('section.live')}</li>
              : null}
            {liveRows.length > 0
              ? <JobRows rows={liveRows} {...rowProps} />
              : null}
            {liveRows.length > 0 && settledRows.length > 0
              ? <li className={css.section} role="presentation">{t('section.settled')}</li>
              : null}
            {settledRows.length > 0
              ? <JobRows rows={settledRows} {...rowProps} />
              : null}
          </ul>
        )
        : null}
    </div>
  )
}
