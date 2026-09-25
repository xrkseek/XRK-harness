import type { JobView } from '@xrkseek/client-runtime/client'
import type { StateDotState } from '@xrkseek/client-ui-primitives'
import type { LocaleKeysOf, TranslateNS } from '@xrkseek/client-ui-slots'

/** A job the registry still holds open, and whose duration therefore ticks. */
export function isLiveJob(job: JobView): boolean {
  return job.status === 'running' || job.status === 'stopping'
}

/**
 * Status marker semantics. The status set crosses RPC from a host this build
 * may not match, so the table is the compile-time fence AND the runtime guard:
 * a status added by a newer host renders the amber dot instead of crashing
 * the row. `warning` is the "something unusual, treat as live attention"
 * state — deliberately not `done` (which would claim success) and not `error`
 * (which claims failure).
 */
const DOT_BY_STATUS: { [Key in JobView['status']]: StateDotState } = {
  running: 'ongoing',
  stopping: 'warning',
  completed: 'done',
  killed: 'warning',
  failed: 'error',
}

/** Unknown wire statuses (host added one this build has not seen) render amber. */
const UNKNOWN_JOB_DOT: StateDotState = 'warning'

export function jobDotState(status: JobView['status']): StateDotState {
  return DOT_BY_STATUS[status] ?? UNKNOWN_JOB_DOT
}

/**
 * Human status word for the row and its accessible name.
 * Unknown wire statuses keep their raw word rather than crashing the row.
 */
const STATUS_WORD_KEY = {
  running: 'status.running',
  stopping: 'status.stopping',
  completed: 'status.completed',
  killed: 'status.killed',
  failed: 'status.failed',
} as const satisfies Record<JobView['status'], LocaleKeysOf<'job'>>

export function jobStatusLabel(status: JobView['status'], t: TranslateNS<'job'>): string {
  const key = STATUS_WORD_KEY[status]
  return key === undefined ? status : t(key)
}

/**
 * Elapsed time in at most two adjacent units.
 * Under 10s uses one decimal so sub-second settles are not labeled `0秒`.
 */
export function formatJobDuration(elapsedMs: number, t: TranslateNS<'job'>): string {
  const ms = Math.max(0, elapsedMs)
  if (ms < 10_000) {
    let tenths = Math.round(ms / 100) / 10
    // Sub-50ms settles still took wall time — never label a real run as 0.
    if (ms > 0 && tenths === 0) tenths = 0.1
    return t('duration.seconds', { seconds: tenths })
  }
  const total = Math.floor(ms / 1_000)
  const seconds = total % 60
  const minutes = Math.floor(total / 60) % 60
  const hours = Math.floor(total / 3_600)
  if (hours > 0) return t('duration.hours', { hours, minutes })
  if (minutes > 0) return t('duration.minutes', { minutes, seconds })
  return t('duration.seconds', { seconds })
}

/** Status word, with producer detail when present (`已完成 · exit code: 0`). */
export function jobStatusText(
  job: Pick<JobView, 'status' | 'detail'>,
  t: TranslateNS<'job'>,
): string {
  const label = jobStatusLabel(job.status, t)
  const detail = job.detail?.trim()
  return detail !== undefined && detail.length > 0 ? `${label} · ${detail}` : label
}

/** Live rows first in start order, then settled rows newest-first. */
export function orderedJobs(jobs: readonly JobView[]): JobView[] {
  return [...jobs].sort((left, right) => {
    const liveLeft = isLiveJob(left)
    if (liveLeft !== isLiveJob(right)) return liveLeft ? -1 : 1
    if (liveLeft) return left.startedAt - right.startedAt
    const finished = (right.finishedAt ?? right.startedAt) - (left.finishedAt ?? left.startedAt)
    return finished !== 0 ? finished : left.startedAt - right.startedAt
  })
}

export type JobListActions = {
  killJob(jobId: string): void
  backgroundJob(jobId: string): void
}

export type JobRowStyle = {
  row: string
  rowSettled: string
  rowDot: string
  kind: string
  label: string
  status: string
  duration: string
  action: string
}
