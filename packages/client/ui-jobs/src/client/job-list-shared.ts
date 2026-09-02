import type { JobView } from '@xrkseek/client-runtime/client'
import type { StateDotState } from '@xrkseek/client-ui-primitives'
import type { TranslateNS } from '@xrkseek/client-ui-slots'

/** A job the registry still holds open, and whose duration therefore ticks. */
export function isLiveJob(job: JobView): boolean {
  return job.status === 'running' || job.status === 'stopping'
}

/** Closed-union exhaustiveness fence for the wire status set. */
/* v8 ignore next 3 -- closed-union backstop; only reached if a status is forged */
function assertNever(value: never): never {
  throw new Error(`unhandled job status: ${JSON.stringify(value)}`)
}

/** Status marker semantics. */
export function jobDotState(status: JobView['status']): StateDotState {
  switch (status) {
    case 'running': return 'ongoing'
    case 'stopping': return 'warning'
    case 'completed': return 'done'
    case 'killed': return 'warning'
    case 'failed': return 'error'
    /* v8 ignore next -- closed wire status union */
    default: return assertNever(status)
  }
}

/** Human status word for the row and its accessible name. */
export function jobStatusLabel(status: JobView['status'], t: TranslateNS<'job'>): string {
  switch (status) {
    case 'running': return t('status.running')
    case 'stopping': return t('status.stopping')
    case 'completed': return t('status.completed')
    case 'killed': return t('status.killed')
    case 'failed': return t('status.failed')
    /* v8 ignore next -- closed wire status union */
    default: return assertNever(status)
  }
}

/** Elapsed time in at most two adjacent units. */
export function formatJobDuration(elapsedMs: number, t: TranslateNS<'job'>): string {
  const total = Math.max(0, Math.floor(elapsedMs / 1_000))
  const seconds = total % 60
  const minutes = Math.floor(total / 60) % 60
  const hours = Math.floor(total / 3_600)
  if (hours > 0) return t('duration.hours', { hours, minutes })
  if (minutes > 0) return t('duration.minutes', { minutes, seconds })
  return t('duration.seconds', { seconds })
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
