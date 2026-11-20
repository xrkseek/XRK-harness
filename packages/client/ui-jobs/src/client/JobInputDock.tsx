import { useEffect, useMemo, useState } from 'react'
import type { JobView } from '@xrkseek/client-runtime/client'
import type { PropsLocale, PropsRuntime } from '@xrkseek/client-ui-slots'
import { IconChevronDownOutlineRegular, IconChevronUpOutlineRegular } from '@xrkseek/client-ui-primitives'
import { isLiveJob, orderedJobs, type JobListActions } from './job-list-shared.ts'
import { JobOutputPanel, JobRows, KillAllButton } from './JobRows.tsx'
import type { JobListInjected } from './JobListAction.tsx'
import { useJobClock } from './use-job-clock.ts'
import { NS } from './locales.ts'
import css from './JobInputDock.module.css'
import headerCss from './JobListAction.module.css'

/** Stable empty list so a session with no jobs keeps one array identity. */
const NO_TASKS: readonly JobView[] = []

export type JobInputDockProps =
  PropsRuntime<'conversation.input.dock'> & JobListInjected & PropsLocale<typeof NS>

/**
 * Input-zone strip for live background jobs (TodoDock posture): visible while
 * at least one job is running so Stop / Background stay near the composer.
 * One live job renders the action row directly (no empty collapsible chrome).
 *
 * Collapsed multi-job chrome keeps one **Stop all** control (not "stop the
 * oldest row") so the summary count and the button mean the same thing.
 *
 * Multi-job expand mounts {@link JobOutputPanel} *beside* the row list so the
 * list stays a short scrollport and TerminalBlock owns output scrolling.
 * @param props - session jobs mirror plus stop/background actions.
 * @returns dock card or null when nothing is live.
 */
export function JobInputDock({ sessionId, useSessions, killJob, backgroundJob, t }: JobInputDockProps) {
  const jobs = useSessions(state => state.jobsBySession[sessionId]) ?? NO_TASKS
  const liveJobs = useMemo(() => jobs.filter(isLiveJob), [jobs])
  const [collapsed, setCollapsed] = useState(true)
  const [expandedId, setExpandedId] = useState<string | undefined>(undefined)
  const now = useJobClock(liveJobs.length > 0)
  const rows = useMemo(() => orderedJobs(liveJobs), [liveJobs])

  useEffect(() => {
    if (expandedId === undefined) return
    if (!rows.some((job) => job.id === expandedId)) setExpandedId(undefined)
  }, [rows, expandedId])

  if (liveJobs.length === 0) return null

  const actions: JobListActions = { killJob, backgroundJob }
  const single = rows.length === 1
  const listOpen = single || !collapsed
  const expandedJob = expandedId === undefined
    ? undefined
    : rows.find((job) => job.id === expandedId)

  const onToggleExpand = (jobId: string): void => {
    if (!single && collapsed) setCollapsed(false)
    setExpandedId((current) => (current === jobId ? undefined : jobId))
  }

  return (
    <section className={css.root} data-testid="job-input-dock" aria-label={t('dock.aria')}>
      <div
        className={css.body}
        data-output-open={expandedJob !== undefined ? '' : undefined}
      >
        {!single
          ? (
            <div className={css.headerRow}>
              <button
                type="button"
                className={css.header}
                aria-expanded={listOpen}
                onClick={() => {
                  setCollapsed((value) => {
                    if (!value) setExpandedId(undefined)
                    return !value
                  })
                }}
              >
                <span className={css.title}>{t('dock.title')}</span>
                <span className={css.summary}>
                  {t('count.live.other', { count: liveJobs.length })}
                </span>
                <span className={css.chevron} aria-hidden>
                  {collapsed ? <IconChevronUpOutlineRegular /> : <IconChevronDownOutlineRegular />}
                </span>
              </button>
              {collapsed
                ? (
                  <KillAllButton
                    jobs={rows}
                    t={t}
                    css={headerCss}
                    killJob={killJob}
                  />
                )
                : null}
            </div>
          )
          : null}
        {listOpen
          ? (
            <ul className={css.list} aria-label={t('list.aria')}>
              <JobRows
                rows={rows}
                now={now}
                t={t}
                css={headerCss}
                {...actions}
                expandedId={expandedId}
                onToggleExpand={onToggleExpand}
                embedOutput={false}
              />
            </ul>
          )
          : null}
        {listOpen && expandedJob !== undefined
          ? (
            <div className={css.outputSlot}>
              <JobOutputPanel
                job={expandedJob}
                live={isLiveJob(expandedJob)}
                t={t}
                css={headerCss}
              />
            </div>
          )
          : null}
      </div>
    </section>
  )
}
