/**
 * Background-job plugin, browser half: contributes one session-header action
 * that renders this session's `ctx.jobs` records. The data arrives entirely
 * through the `jobsBySession` list mirror, so the plugin issues no RPC and
 * holds no state of its own beyond popover visibility.
 */
import type { ClientContext, SessionId } from '@xrkseek/client-runtime/client'
import { JobListAction, type JobListInjected } from './JobListAction.tsx'
import type {} from '@xrkseek/client-locale/client'
import { en, NS, zh, type JobKey } from './locales.ts'

declare module '@xrkseek/client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Background-job list copy. */
    'job': JobKey
  }
}

export type { JobListActionProps, JobListInjected } from './JobListAction.tsx'

/** Required services for locale registration and header-slot contribution. */
export const inject = ['sessions', 'slots', 'locale']

/**
 * Client plugin body: register the dictionaries and the header action.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-job: dictionaries')
  const sessions = ctx.sessions
  const jobActions = (ownerSessionId: SessionId): JobListInjected => ({
    killJob(jobId) {
      void sessions.binding(ownerSessionId)?.session.killJob(jobId)
    },
    backgroundJob(jobId) {
      void sessions.binding(ownerSessionId)?.session.backgroundJob(jobId)
    },
  })
  ctx.slots.inject(
    'conversation.session.header.actions',
    () => ctx.slots.register({
      name: 'conversation.session.header.actions',
      id: 'job-list',
      // After the subagent catalog: session lineage reads before process work.
      order: 20,
      locale: NS,
      inject: jobActions,
    }, JobListAction),
  )
}
