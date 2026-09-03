import { useEffect, useMemo, useState } from 'react'
import type { JobView } from '@xrkseek/client-runtime/client'
import type { PropsLocale, PropsRuntime } from '@xrkseek/client-ui-slots'
import { IconChevronDownOutline14, IconChevronUpOutline14 } from '@xrkseek/client-ui-primitives'
import { isLiveJob, orderedJobs, type JobListActions } from './job-list-shared.ts'
import { JobRows } from './JobRows.tsx'
import type { JobListInjected } from './JobListAction.tsx'
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
 * @param props - session jobs mirror plus stop/background actions.
 * @returns collapsible dock card or null when nothing is live.
 */
export function JobInputDock({ sessionId, useSessions, killJob, backgroundJob, t }: JobInputDockProps) {
  const jobs = useSessions(state => state.jobsBySession[sessionId]) ?? NO_TASKS
  const liveJobs = useMemo(() => jobs.filter(isLiveJob), [jobs])
  const [collapsed, setCollapsed] = useState(true)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (liveJobs.length === 0) return
    setNow(Date.now())
    const timer = setInterval(() => { setNow(Date.now()) }, 1_000)
    return () => { clearInterval(timer) }
  }, [liveJobs.length])

  if (liveJobs.length === 0) return null

  const rows = orderedJobs(liveJobs)
  const countKey = liveJobs.length === 1 ? 'count.live.one' : 'count.live.other'
  const summary = t(countKey, { count: liveJobs.length })
  const actions: JobListActions = { killJob, backgroundJob }

  return (
    <section className={css.root} data-testid="job-input-dock" aria-label={t('dock.aria')}>
      <div className={css.body}>
        <button
          type="button"
          className={css.header}
          aria-expanded={!collapsed}
          onClick={() => { setCollapsed(v => !v) }}
        >
          <span className={css.title}>{t('dock.title')}</span>
          <span className={css.summary}>{summary}</span>
          <span className={css.chevron} aria-hidden>
            {collapsed ? <IconChevronUpOutline14 /> : <IconChevronDownOutline14 />}
          </span>
        </button>
        {!collapsed
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
