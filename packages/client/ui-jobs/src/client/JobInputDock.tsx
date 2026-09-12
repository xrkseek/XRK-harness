import { useMemo, useState, type MouseEvent } from 'react'
import type { JobView } from '@xrkseek/client-runtime/client'
import type { PropsLocale, PropsRuntime } from '@xrkseek/client-ui-slots'
import { IconChevronDownOutline14, IconChevronUpOutline14 } from '@xrkseek/client-ui-primitives'
import { isLiveJob, orderedJobs, type JobListActions } from './job-list-shared.ts'
import { JobRows } from './JobRows.tsx'
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
 * @param props - session jobs mirror plus stop/background actions.
 * @returns dock card or null when nothing is live.
 */
export function JobInputDock({ sessionId, useSessions, killJob, backgroundJob, t }: JobInputDockProps) {
  const jobs = useSessions(state => state.jobsBySession[sessionId]) ?? NO_TASKS
  const liveJobs = useMemo(() => jobs.filter(isLiveJob), [jobs])
  const [collapsed, setCollapsed] = useState(true)
  const now = useJobClock(liveJobs.length > 0)

  if (liveJobs.length === 0) return null

  const rows = orderedJobs(liveJobs)
  const actions: JobListActions = { killJob, backgroundJob }
  const single = rows.length === 1
  const expanded = single || !collapsed
  const primary = rows[0]

  const onStopPrimary = (event: MouseEvent<HTMLButtonElement>): void => {
    event.stopPropagation()
    if (primary !== undefined) killJob(primary.id)
  }

  return (
    <section className={css.root} data-testid="job-input-dock" aria-label={t('dock.aria')}>
      <div className={css.body}>
        {!single
          ? (
            <div className={css.headerRow}>
              <button
                type="button"
                className={css.header}
                aria-expanded={expanded}
                onClick={() => { setCollapsed(value => !value) }}
              >
                <span className={css.title}>{t('dock.title')}</span>
                <span className={css.summary}>
                  {t('count.live.other', { count: liveJobs.length })}
                </span>
                <span className={css.chevron} aria-hidden>
                  {collapsed ? <IconChevronUpOutline14 /> : <IconChevronDownOutline14 />}
                </span>
              </button>
              {collapsed && primary !== undefined
                ? (
                  <button
                    type="button"
                    className={headerCss.action}
                    aria-label={t('action.stop.aria', { label: primary.label })}
                    onClick={onStopPrimary}
                  >
                    {t('action.stop')}
                  </button>
                )
                : null}
            </div>
          )
          : null}
        {expanded
          ? (
            <ul className={css.list} aria-label={t('list.aria')}>
              <JobRows
                rows={rows}
                now={now}
                t={t}
                css={headerCss}
                {...actions}
              />
            </ul>
          )
          : null}
      </div>
    </section>
  )
}
