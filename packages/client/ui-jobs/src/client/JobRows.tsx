import type { MouseEvent } from 'react'
import type { JobView } from '@xrkseek/client-runtime/client'
import { StateDot } from '@xrkseek/client-ui-primitives'
import type { TranslateNS } from '@xrkseek/client-ui-slots'
import {
  formatJobDuration,
  isLiveJob,
  jobDotState,
  jobStatusLabel,
  type JobListActions,
  type JobRowStyle,
} from './job-list-shared.ts'

export type JobRowsProps = JobListActions & {
  rows: readonly JobView[]
  now: number
  t: TranslateNS<'job'>
  css: JobRowStyle
}

/**
 * Shared job rows for the session-header popover and the input dock panel.
 * @param props - rows, clock, locale, styles, and stop/background handlers.
 * @returns list items for each job.
 */
export function JobRows({ rows, now, t, css, killJob, backgroundJob }: JobRowsProps) {
  const onStop = (event: MouseEvent<HTMLButtonElement>, job: JobView): void => {
    event.stopPropagation()
    killJob(job.id)
  }

  const onBackground = (event: MouseEvent<HTMLButtonElement>, job: JobView): void => {
    event.stopPropagation()
    backgroundJob(job.id)
  }

  return (
    <>
      {rows.map((job) => {
        const live = isLiveJob(job)
        const elapsed = live ? now - job.startedAt : (job.finishedAt ?? job.startedAt) - job.startedAt
        const duration = formatJobDuration(elapsed, t)
        const status = jobStatusLabel(job.status, t)
        return (
          <li key={job.id} className={live ? css.row : `${css.row} ${css.rowSettled}`}>
            <StateDot state={jobDotState(job.status)} className={css.rowDot} />
            <span className={css.kind}>{job.kind}</span>
            <span className={css.label} title={job.label}>{job.label}</span>
            <span className={css.status} title={job.detail ?? status}>{job.detail ?? status}</span>
            <span
              className={css.duration}
              title={t(live ? 'duration.title.live' : 'duration.title.done', { duration })}
            >
              {duration}
            </span>
            {live
              ? (
                <button
                  type="button"
                  className={css.action}
                  aria-label={t('action.stop.aria', { label: job.label })}
                  onClick={(event) => { onStop(event, job) }}
                >
                  {t('action.stop')}
                </button>
              )
              : null}
            {job.foreground && job.status === 'running'
              ? (
                <button
                  type="button"
                  className={css.action}
                  aria-label={t('action.background.aria', { label: job.label })}
                  onClick={(event) => { onBackground(event, job) }}
                >
                  {t('action.background')}
                </button>
              )
              : null}
          </li>
        )
      })}
    </>
  )
}
