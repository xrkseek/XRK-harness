import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import type { JobView } from '@xrkseek/client-runtime/client'
import {
  IconChevronDownOutline14,
  IconStopFill16,
  StateDot,
  TerminalBlock,
  type TerminalBlockLabels,
} from '@xrkseek/client-ui-primitives'
import type { TranslateNS } from '@xrkseek/client-ui-slots'
import {
  formatJobDuration,
  isLiveJob,
  jobDotState,
  jobStatusText,
  type JobListActions,
} from './job-list-shared.ts'
import { peekJobOutput } from './job-output-api.ts'
import type { JobKey } from './locales.ts'

/** Styles shared by header popover and input dock (JobListAction.module.css). */
export type JobRowStyle = {
  row: string
  rowSettled: string
  rowDot: string
  kind: string
  label: string
  status: string
  duration: string
  action: string
  rowLine: string
  rowLineLive: string
  rowStatic: string
  chevronBox: string
  chevronOpen: string
  stop: string
  stopArmed: string
  stopFailed: string
  stopLabel: string
  panel: string
  notice: string
  noticeError: string
  primary: string
  secondary: string
}

export type JobRowsProps = JobListActions & {
  rows: readonly JobView[]
  now: number
  t: TranslateNS<'job'>
  css: JobRowStyle
  /** Currently expanded job id (output panel). */
  expandedId?: string
  onToggleExpand?: (jobId: string) => void
}

const KILL_ARM_MS = 3_000
const KILL_FAILED_MS = 4_000
const OUTPUT_POLL_MS = 400

type KillState = 'idle' | 'armed' | 'pending' | 'failed'

function terminalLabels(t: TranslateNS<'job'>): TerminalBlockLabels {
  return {
    signal: (signal) => t('terminal.signal', { signal }),
    exitCode: (code) => t('terminal.exitCode', { code }),
    running: t('terminal.running'),
    failed: t('terminal.failed'),
    done: t('terminal.done'),
    copy: t('terminal.copy'),
    copied: t('terminal.copied'),
    noOutput: t('terminal.noOutput'),
    collapseAria: t('terminal.collapseAria'),
    collapse: t('terminal.collapse'),
    expandAria: (n) => t('terminal.expandAria', { n }),
    expand: (n) => t('terminal.expand', { n }),
  }
}

function JobOutputPanel({
  job,
  live,
  t,
  css,
}: {
  job: JobView
  live: boolean
  t: TranslateNS<'job'>
  css: JobRowStyle
}) {
  const [text, setText] = useState('')
  const [truncated, setTruncated] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const labels = useMemo(() => terminalLabels(t), [t])

  useEffect(() => {
    let alive = true
    const load = async (): Promise<void> => {
      try {
        const next = await peekJobOutput(job.id)
        if (!alive) return
        setText(next.text)
        setTruncated(next.truncated)
        setError(undefined)
      } catch (err) {
        if (!alive) return
        setError(err instanceof Error ? err.message : String(err))
      }
    }
    void load()
    if (!live) return () => { alive = false }
    const timer = setInterval(() => { void load() }, OUTPUT_POLL_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [job.id, live, job.status])

  return (
    <div className={css.panel}>
      {truncated ? <div className={css.notice}>{t('output.truncated')}</div> : null}
      {error !== undefined
        ? <div className={`${css.notice} ${css.noticeError}`}>{t('output.error', { error })}</div>
        : null}
      <TerminalBlock
        command={job.label}
        output={text}
        running={live}
        maxLines={Number.POSITIVE_INFINITY}
        labels={labels}
      />
    </div>
  )
}

function KillButton({
  job,
  t,
  css,
  killJob,
}: {
  job: JobView
  t: TranslateNS<'job'>
  css: JobRowStyle
  killJob: (jobId: string) => void
}) {
  const [state, setState] = useState<KillState>('idle')
  const armTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const failTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => () => {
    if (armTimer.current !== undefined) clearTimeout(armTimer.current)
    if (failTimer.current !== undefined) clearTimeout(failTimer.current)
  }, [])

  // Status flip away from running clears the button.
  useEffect(() => {
    if (job.status === 'running' || job.status === 'stopping') return
    setState('idle')
  }, [job.status])

  const title = state === 'armed'
    ? t('kill.confirmTitle')
    : state === 'failed'
      ? t('kill.failedTitle')
      : t('action.stop.aria', { label: job.label })

  const onPress = (event: MouseEvent<HTMLButtonElement>): void => {
    event.stopPropagation()
    if (state === 'pending') return
    if (state === 'idle' || state === 'failed') {
      setState('armed')
      if (armTimer.current !== undefined) clearTimeout(armTimer.current)
      armTimer.current = setTimeout(() => { setState('idle') }, KILL_ARM_MS)
      return
    }
    if (armTimer.current !== undefined) clearTimeout(armTimer.current)
    setState('pending')
    try {
      killJob(job.id)
    } catch {
      setState('failed')
      if (failTimer.current !== undefined) clearTimeout(failTimer.current)
      failTimer.current = setTimeout(() => { setState('idle') }, KILL_FAILED_MS)
    }
  }

  return (
    <button
      type="button"
      className={
        state === 'armed'
          ? `${css.stop} ${css.stopArmed}`
          : state === 'failed'
            ? `${css.stop} ${css.stopFailed}`
            : css.stop
      }
      data-kill-state={state}
      disabled={state === 'pending'}
      aria-label={title}
      title={title}
      onClick={onPress}
    >
      <IconStopFill16 size={10} />
      {state === 'armed' ? <span className={css.stopLabel}>{t('kill.confirmAction')}</span> : null}
    </button>
  )
}

/**
 * Shared job rows for the session-header popover and the input dock panel.
 * Expandable rows poll Host `jobs.output` into a TerminalBlock (Cursor-style).
 */
export function JobRows({
  rows,
  now,
  t,
  css,
  killJob,
  backgroundJob,
  expandedId,
  onToggleExpand,
}: JobRowsProps) {
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
        const status = jobStatusText(job, t)
        const expanded = expandedId === job.id
        const expandable = onToggleExpand !== undefined
        const body = (
          <>
            <StateDot state={jobDotState(job.status)} className={css.rowDot} />
            {expandable
              ? (
                <span className={css.chevronBox} aria-hidden>
                  <IconChevronDownOutline14
                    size={10}
                    className={expanded ? css.chevronOpen : undefined}
                  />
                </span>
              )
              : null}
            <span className={css.kind} data-job-cell="kind">{job.kind}</span>
            <span className={css.primary}>
              <span className={css.label} data-job-cell="label" title={job.label}>{job.label}</span>
              <span className={css.secondary}>
                <span className={css.status} data-job-cell="status" title={status}>{status}</span>
                <span
                  className={css.duration}
                  data-job-cell="duration"
                  title={t(live ? 'duration.title.live' : 'duration.title.done', { duration })}
                >
                  {duration}
                </span>
              </span>
            </span>
          </>
        )
        return (
          <li key={job.id}>
            <div className={live ? `${css.rowLine} ${css.rowLineLive}` : css.rowLine}>
              {expandable
                ? (
                  <button
                    type="button"
                    className={live ? css.row : `${css.row} ${css.rowSettled}`}
                    aria-expanded={expanded}
                    aria-label={t(expanded ? 'row.collapseAria' : 'row.expandAria', { label: job.label })}
                    onClick={() => { onToggleExpand(job.id) }}
                  >
                    {body}
                  </button>
                )
                : (
                  <span className={`${css.row} ${live ? '' : css.rowSettled} ${css.rowStatic}`}>
                    {body}
                  </span>
                )}
              {live
                ? <KillButton job={job} t={t} css={css} killJob={killJob} />
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
            </div>
            {expanded
              ? <JobOutputPanel job={job} live={live} t={t} css={css} />
              : null}
          </li>
        )
      })}
    </>
  )
}

/** Locale keys this module reads (compile-time seat for new strings). */
export type JobRowsLocaleKeys = Extract<
  JobKey,
  | 'terminal.signal'
  | 'terminal.exitCode'
  | 'terminal.running'
  | 'terminal.failed'
  | 'terminal.done'
  | 'terminal.copy'
  | 'terminal.copied'
  | 'terminal.noOutput'
  | 'terminal.collapseAria'
  | 'terminal.collapse'
  | 'terminal.expandAria'
  | 'terminal.expand'
  | 'output.truncated'
  | 'output.error'
  | 'kill.confirmTitle'
  | 'kill.failedTitle'
  | 'kill.confirmAction'
  | 'row.expandAria'
  | 'row.collapseAria'
>
