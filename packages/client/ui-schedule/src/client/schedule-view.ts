/**
 * Pure projections from the cron wire shapes to display copy.
 *
 * Everything here is a pure function of the HTTP view types so the rendering
 * logic stays unit-testable without a browser or a Host. The `t` argument is
 * the namespace translator bound by the slot renderer.
 */

import type {
  CronDeliveryView,
  CronJobView,
  CronRunRecordView,
  CronScheduleView,
} from './cron-api.ts'
import type { ScheduleLocaleKey } from './locales.ts'

export type ScheduleT = (key: ScheduleLocaleKey, params?: Record<string, string | number>) => string

/** Localized schedule caption: every / one-shot at / cron expression. */
export function scheduleLabel(schedule: CronScheduleView, t: ScheduleT): string {
  switch (schedule.kind) {
    case 'every': return t('scheduleEvery', { seconds: schedule.everySeconds })
    case 'at': return t('scheduleAt', { time: schedule.at })
    case 'cron': return t('scheduleCron', { expr: schedule.expr })
  }
}

/** Localized run caption: agent prompt or script command. */
export function runLabel(run: CronJobView['run'], t: ScheduleT): string {
  switch (run.kind) {
    case 'agent': return t('runAgent', { prompt: run.prompt })
    case 'script': return t('runScript', { command: run.command })
  }
}

/** Localized delivery caption. */
export function deliveryLabel(delivery: CronDeliveryView, t: ScheduleT): string {
  switch (delivery.kind) {
    case 'none': return t('deliveryNone')
    case 'webhook': return t('deliveryWebhook')
    case 'file': return t('deliveryFile')
  }
}

/** Localized last-run status caption, or the never-run line. */
export function lastStatusLabel(job: CronJobView, t: ScheduleT): string {
  if (job.lastStatus === undefined) return t('lastStatusNone')
  switch (job.lastStatus) {
    case 'ok': return t('lastStatusOk')
    case 'error': return t('lastStatusError')
    case 'skipped': return t('lastStatusSkipped')
  }
}

/** Localized execution status caption. */
export function runStatusLabel(run: CronRunRecordView, t: ScheduleT): string {
  switch (run.status) {
    case 'ok': return t('runStatusOk')
    case 'error': return t('runStatusError')
    case 'skipped': return t('runStatusSkipped')
  }
}

/** A stable filtered view key for a schedule (drives React memoization). */
export function scheduleKey(schedule: CronScheduleView): string {
  switch (schedule.kind) {
    case 'every': return `every:${schedule.everySeconds}`
    case 'at': return `at:${schedule.at}`
    case 'cron': return `cron:${schedule.expr}`
  }
}

/** Display name for a job row (falls back to the anonymous copy). */
export function jobDisplayName(job: CronJobView, t: ScheduleT): string {
  return typeof job.name === 'string' && job.name.length > 0 ? job.name : t('jobNameFallback')
}