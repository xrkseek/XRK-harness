/** Scheduled-task directory tab: cron catalog + per-job actions + run history. */

import { useEffect, useId, useState, type ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@xrkseek/client-ui-slots'
import { IconChevronDownOutline14 } from '@xrkseek/client-ui-primitives'
import type {
  CronApiClient,
  CronJobMutationResponse,
  CronJobView,
  CronRunRecordView,
} from './cron-api.ts'
import type { ScheduleLocaleKey } from './locales.ts'
import {
  deliveryLabel,
  jobDisplayName,
  lastStatusLabel,
  runLabel,
  runStatusLabel,
  scheduleLabel,
  type ScheduleT,
} from './schedule-view.ts'
import css from './ScheduleSettingsTab.module.css'

/** Registration-side data face bound by the tab entry's inject. */
export interface ScheduleSettingsTabInjected {
  /** Browser data client for the Host cron API. */
  api: CronApiClient
}

/** Full props assembled by the Settings slot renderer. */
export type ScheduleSettingsTabProps =
  PropsRuntime<'settings.plugins.tab'>
  & PropsLocale<'schedule'>
  & InjectFace<ScheduleSettingsTabInjected>

type ViewState =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly jobs: readonly CronJobView[] }

/** Localized timestamp (browser zone, medium locale). */
function formatTimestamp(iso: string): string {
  const parsed = new Date(iso)
  return Number.isNaN(parsed.getTime()) ? iso : parsed.toLocaleString()
}

function modelLabel(job: CronJobView, t: ScheduleT): string {
  if (job.run.kind !== 'agent') return '—'
  if (job.run.provider && job.run.model) {
    return `${job.run.provider} / ${job.run.model}`
  }
  return t('modelUnset')
}

/** Render the scheduled-task directory (jobs + expanded run history). */
export function ScheduleSettingsTab({ api, t }: ScheduleSettingsTabProps): ReactNode {
  const runsId = useId()
  const [request, setRequest] = useState(0)
  const [state, setState] = useState<ViewState>({ status: 'loading' })
  const [expandedId, setExpandedId] = useState<string | null>(null)

  useEffect(() => {
    let current = true
    const controller = new AbortController()
    void Promise.resolve().then(() => api.listJobs(controller.signal)).then(
      (response) => {
        if (!current) return
        // Honest dsh-compat catch-all (or a mis-routed stub) returns 200 without
        // `jobs` — treat as error so the tab does not crash on `jobs.length`.
        if (!Array.isArray(response?.jobs)) {
          setState({ status: 'error' })
          return
        }
        setState({ status: 'ready', jobs: response.jobs })
      },
      (error: unknown) => {
        if (current) {
          const cancelled = error instanceof DOMException && error.name === 'AbortError'
          if (!cancelled) setState({ status: 'error' })
        }
      },
    )
    return () => {
      current = false
      controller.abort()
    }
  }, [api, request])

  const jobs = state.status === 'ready' ? state.jobs : []
  useEffect(() => {
    if (expandedId !== null && !jobs.some(job => job.id === expandedId)) {
      setExpandedId(null)
    }
  }, [expandedId, jobs])

  const retry = (): void => {
    setState({ status: 'loading' })
    setRequest(value => value + 1)
  }

  const refreshQuiet = (): void => {
    setRequest(value => value + 1)
  }

  return (
    <div className={css.section} aria-busy={state.status === 'loading'}>
      {state.status === 'loading' ? <p className={css.status}>{t('loading')}</p> : null}
      {state.status === 'error' ? (
        <div className={css.failure}>
          <p role="alert">{t('error')}</p>
          <p className={css.hint} role="note">{t('errorHint')}</p>
          <button type="button" onClick={retry}>{t('retry')}</button>
        </div>
      ) : null}
      {state.status === 'ready' ? (
        <div className={css.catalog}>
          <div className={css.catalogHeading}>
            <h3 data-job-count={jobs.length}>{t('summary', { count: jobs.length })}</h3>
            <button
              className={css.refresh}
              type="button"
              onClick={retry}
            >
              {t('refresh')}
            </button>
          </div>
          {jobs.length === 0 ? <p className={css.status}>{t('empty')}</p> : null}
          {jobs.length > 0 ? (
            <ul className={css.cards}>
              {jobs.map((job) => {
                const title = jobDisplayName(job, t)
                const open = expandedId === job.id
                const detailId = `${runsId}-details-${encodeURIComponent(job.id)}`
                const ariaBits = [
                  title,
                  job.enabled ? t('enabledTag') : t('disabledTag'),
                  scheduleLabel(job.schedule, t),
                  lastStatusLabel(job, t),
                ].filter(Boolean).join(', ')
                return (
                  <li
                    className={css.card}
                    key={job.id}
                    data-job-id={job.id}
                    data-enabled={job.enabled ? 'true' : 'false'}
                    data-open={open ? 'true' : undefined}
                  >
                    <button
                      className={css.cardContent}
                      type="button"
                      aria-expanded={open}
                      aria-controls={detailId}
                      aria-label={ariaBits}
                      onClick={() => {
                        setExpandedId(current => current === job.id ? null : job.id)
                      }}
                    >
                      <span className={css.cardTitleBlock}>
                        <strong className={css.cardTitle} title={job.id}>{title}</strong>
                        {job.enabled ? (
                          <span className={css.enabledTag}>{t('enabledTag')}</span>
                        ) : (
                          <span className={css.disabledTag}>{t('disabledTag')}</span>
                        )}
                      </span>
                      <span className={css.cardTrailing}>
                        <span className={css.scheduleTag}>{scheduleLabel(job.schedule, t)}</span>
                        <span
                          className={css.statusDot}
                          data-status={job.lastStatus ?? 'never'}
                          role="img"
                          aria-label={lastStatusLabel(job, t)}
                          title={lastStatusLabel(job, t)}
                        />
                        {job.nextRunAt !== null && job.enabled ? (
                          <time className={css.nextRun} dateTime={job.nextRunAt}>{formatTimestamp(job.nextRunAt)}</time>
                        ) : null}
                        <IconChevronDownOutline14 className={css.chevron} size={12} aria-hidden="true" />
                      </span>
                    </button>
                    {open ? (
                      <JobDetail
                        api={api}
                        job={job}
                        t={t}
                        detailId={detailId}
                        onChanged={refreshQuiet}
                      />
                    ) : null}
                  </li>
                )
              })}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

type JobAction = 'pause' | 'resume' | 'run' | 'remove'

/** One expanded job: actions, run kind, delivery, then the run-history ledger. */
function JobDetail({
  api,
  job,
  t,
  detailId,
  onChanged,
}: {
  readonly api: CronApiClient
  readonly job: CronJobView
  readonly t: ScheduleT
  readonly detailId: string
  readonly onChanged: () => void
}): ReactNode {
  const [busy, setBusy] = useState<JobAction | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [runsTick, setRunsTick] = useState(0)

  const act = (action: JobAction): void => {
    if (busy) return
    if (action === 'remove' && !globalThis.confirm?.(t('confirmRemove'))) return
    setBusy(action)
    setActionError(null)
    const run =
      action === 'pause' ? api.pause(job.id)
        : action === 'resume' ? api.resume(job.id)
          : action === 'run' ? api.runNow(job.id)
            : api.remove(job.id)
    void run.then(
      (response: CronJobMutationResponse) => {
        setBusy(null)
        if (action === 'run' && response.ok === false) {
          const message = response.result?.error?.trim() || t('actionError')
          setActionError(t('actionRunFailed', { message }))
        }
        if (action === 'run') setRunsTick(value => value + 1)
        onChanged()
      },
      () => {
        setBusy(null)
        setActionError(t('actionError'))
      },
    )
  }

  return (
    <div className={css.cardDetails} id={detailId}>
      <div className={css.actions} role="group" aria-label={jobDisplayName(job, t)}>
        {job.enabled ? (
          <button type="button" disabled={busy !== null} onClick={() => act('pause')}>
            {busy === 'pause' ? t('actionBusy') : t('actionPause')}
          </button>
        ) : (
          <button type="button" disabled={busy !== null} onClick={() => act('resume')}>
            {busy === 'resume' ? t('actionBusy') : t('actionResume')}
          </button>
        )}
        <button type="button" disabled={busy !== null} onClick={() => act('run')}>
          {busy === 'run' ? t('actionBusy') : t('actionRun')}
        </button>
        <button
          type="button"
          className={css.danger}
          disabled={busy !== null}
          onClick={() => act('remove')}
        >
          {busy === 'remove' ? t('actionBusy') : t('actionRemove')}
        </button>
      </div>
      {actionError ? <p className={css.actionError} role="alert">{actionError}</p> : null}
      <dl className={css.details}>
        <div>
          <dt>{t('detailRun')}</dt>
          <dd title={job.run.kind === 'agent' ? job.run.prompt : job.run.command}>
            {runLabel(job.run, t)}
          </dd>
        </div>
        <div>
          <dt>{t('detailModel')}</dt>
          <dd>{modelLabel(job, t)}</dd>
        </div>
        <div>
          <dt>{t('detailDelivery')}</dt>
          <dd>{deliveryLabel(job.delivery, t)}</dd>
        </div>
        <div>
          <dt>{t('detailLastRun')}</dt>
          <dd>{lastStatusLabel(job, t)}{job.lastRunAt ? ` · ${formatTimestamp(job.lastRunAt)}` : ''}</dd>
        </div>
      </dl>
      <RunHistory
        api={api}
        job={job}
        t={t}
        refreshKey={`${job.lastRunAt ?? ''}:${job.updatedAt}:${runsTick}`}
      />
    </div>
  )
}

type RunsState =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly runs: readonly CronRunRecordView[] }

/** Ledger for one job, fetched on expand and when the job's last-run stamp changes. */
function RunHistory({
  api,
  job,
  t,
  refreshKey,
}: {
  readonly api: CronApiClient
  readonly job: CronJobView
  readonly t: ScheduleT
  readonly refreshKey: string
}): ReactNode {
  const [request, setRequest] = useState(0)
  const [state, setState] = useState<RunsState>({ status: 'loading' })

  useEffect(() => {
    let current = true
    const controller = new AbortController()
    setState({ status: 'loading' })
    void Promise.resolve().then(() => api.listRuns(job.id, 50, controller.signal)).then(
      (response) => {
        if (current) setState({ status: 'ready', runs: response.runs })
      },
      (error: unknown) => {
        if (current) {
          const cancelled = error instanceof DOMException && error.name === 'AbortError'
          if (!cancelled) setState({ status: 'error' })
        }
      },
    )
    return () => {
      current = false
      controller.abort()
    }
  }, [api, job.id, request, refreshKey])

  const retry = (): void => {
    setState({ status: 'loading' })
    setRequest(value => value + 1)
  }

  return (
    <div className={css.runs}>
      <div className={css.runsHeading}>
        <h4>{t('runsTitle')}</h4>
        {state.status === 'ready' ? <span>{t('runsSummary', { count: state.runs.length })}</span> : null}
      </div>
      {state.status === 'loading' ? <p className={css.status}>{t('loading')}</p> : null}
      {state.status === 'error' ? (
        <div className={css.failure}>
          <p role="alert">{t('error')}</p>
          <button type="button" onClick={retry}>{t('retry')}</button>
        </div>
      ) : null}
      {state.status === 'ready' ? (
        state.runs.length === 0 ? (
          <p className={css.status}>{t('runsEmpty')}</p>
        ) : (
          <ol className={css.runsList} reversed>
            {state.runs.map((run) => (
              <li className={css.runRow} key={run.id} data-status={run.status}>
                <span className={css.runDot} data-status={run.status} role="img" aria-label={runStatusLabel(run, t)} title={runStatusLabel(run, t)} />
                <span className={css.runStatus}>{runStatusLabel(run, t)}</span>
                <span className={css.runMeta}>
                  {formatTimestamp(run.finishedAt)}
                  {run.sessionId ? ` · ${t('sessionRef', { id: run.sessionId })}` : null}
                </span>
                <span className={css.runChars}>{t('outputChars', { chars: run.outputChars })}</span>
                {run.error ? <span className={css.runError}>{run.error}</span> : null}
              </li>
            ))}
          </ol>
        )
      ) : null}
    </div>
  )
}
