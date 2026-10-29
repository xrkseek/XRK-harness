/**
 * Scheduled-task directory on the session header (beside Chat and Trajectory).
 *
 * The cron scheduler lives in the Host process, so this half talks to the Host
 * cron API (`/api/cron/*`, docs/cron.md) over the same loopback gate the Face
 * WebSocket already uses. It contributes a Tasks tab with pause / resume /
 * run / delete — create still flows through the model-facing `cronjob` tool.
 */

import type {} from '@xrkseek/client-locale/client'
import type { ClientContext, SessionId } from '@xrkseek/client-runtime/client'
import type {} from '@xrkseek/client-ui-conversation/client'
import { createCronApiClient, type CronApiClient } from './cron-api.ts'
import { en, ja, zh, type ScheduleLocaleKey } from './locales.ts'
import {
  ScheduleSettingsTab,
  type ScheduleSettingsTabInjected,
} from './ScheduleSettingsTab.tsx'

export type {
  ScheduleSettingsTabInjected,
  ScheduleSettingsTabProps,
} from './ScheduleSettingsTab.tsx'
export type {
  CronApiClient,
  CronDeliveryView,
  CronJobLogsResponse,
  CronJobView,
  CronJobsResponse,
  CronRunRecordView,
  CronRunView,
  CronScheduleView,
} from './cron-api.ts'
export { CronApiError, createCronApiClient } from './cron-api.ts'
export type { ScheduleLocaleKey } from './locales.ts'

declare module '@xrkseek/client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Scheduled-task directory copy. */
    'schedule': ScheduleLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'schedule'

/** Services required by the tab registration. */
export const inject = ['slots', 'locale']

/** Contribute the read-only task directory to the session header. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en, ja }), 'ui-schedule: dictionaries')

  const t = ctx.locale.bind(NS)
  // One client per plugin instance: the tab re-reads through it on mount and
  // retry, and every call carries its own AbortSignal.
  const api: CronApiClient = createCronApiClient()

  // Session header (对话 / 轨迹 / 任务). Host jobs.json is global; this view
  // keeps agent jobs stamped with the session's workspace.
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'schedule',
    order: 20,
    label: () => t('tab'),
    locale: NS,
    inject: (sessionId: SessionId): ScheduleSettingsTabInjected => {
      let filterWorkspaceId: string | undefined
      try {
        const items = ctx.workspaces.list.getSnapshot().items
        filterWorkspaceId = items.find((item) =>
          item.sessionIds.includes(sessionId),
        )?.workspaceId
      } catch {
        filterWorkspaceId = undefined
      }
      return {
        api,
        ...(filterWorkspaceId !== undefined ? { filterWorkspaceId } : {}),
      }
    },
  }, ScheduleSettingsTab))
}