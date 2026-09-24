/**
 * Plan control plugin, browser half: occupies the composer's named
 * `conversation.input.plan` seat with an active-state status chip, and the
 * details column with session Status (subagents · jobs · timeline · cost ·
 * channels; Face `session.status` ≡ `/status`) plus todos / plan / Office tabs.
 * Plan mode is entered through the command source; while the projection's
 * effective target is plan mode the chip renders and executes /plan off through
 * `command.execute`, otherwise the seat stays empty. Status loads via Face
 * unary; plan / todos ride live projections; Office reads `/office` status.
 * Spill rows in the live timeline open via Host `host.openPath`.
 */
import type {} from '@xrkseek/xrk-api-remotes/client'
import type { ConnectionHandle } from '@xrkseek/client-connection/client'
import type { ClientContext, SessionId } from '@xrkseek/client-runtime/client'
// Type-only: pulls the ui-conversation SlotMap merge (the input.plan seat).
import type {} from '@xrkseek/client-ui-conversation/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@xrkseek/client-locale/client'
// Type-only: pulls ctx.layout so the preview column can open and close.
import type {} from '@xrkseek/client-ui-layout/client'
// Type-only: pulls the `plan` SessionProjectionMap merge for useProjection.
import type {} from '@xrkseek/xrk-plan-mode/client'
import { PlanChip } from './PlanModeControl.tsx'
import { PreviewOpenButton, PreviewTabs } from './PreviewTabs.tsx'
import { en, zh, type PlanKey } from './locales.ts'

export type { PlanKey } from './locales.ts'

declare module '@xrkseek/client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The composer plan chip's copy. */
    plan: PlanKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'plan'

/** Injected business face of the composer plan seat. */
export interface PlanChipInjected {
  /**
   * Leave plan mode by executing /plan off.
   * @returns null on admitted execution; a user-visible failure line otherwise.
   */
  exitPlanMode: () => Promise<string | null>
}

/** Required services: slots, commands Remote, locale, layout, and Host openPath. */
export const inject = ['slots', 'remote', 'remote.commands', 'locale', 'layout', 'connection']

/**
 * Client plugin body: register the plan chip over the command channel.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const connection = ctx.get('connection') as ConnectionHandle
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-plan: dictionaries')

  ctx.slots.inject('conversation.input.plan', () => ctx.slots.register({
    name: 'conversation.input.plan',
    locale: NS,
    inject: (sessionId: SessionId): PlanChipInjected => ({
      // Failure strings stay English (error-surface policy: not localized).
      exitPlanMode: async () => {
        const result = await ctx.remote.commands.execute(sessionId, '/plan off')
        if (!result.ok) return `${result.error.message} (${result.error.code})`
        if (result.value === undefined) return 'unknown command: /plan off'
        return null
      },
    }),
  }, PlanChip))

  ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
    name: 'conversation.composer.dock',
    id: 'preview',
    order: 10,
    locale: NS,
    inject: () => ({
      openPreview: () => { ctx.layout.openDetails() },
      closePreview: () => { ctx.layout.closeDetails() },
    }),
  }, PreviewOpenButton))

  ctx.slots.inject('details', () => ctx.slots.register({
    name: 'details',
    locale: NS,
    inject: () => ({
      closeDetails: () => { ctx.layout.closeDetails() },
      openSpillPath: async (path: string) => {
        const response = await connection.api.host.openPath({ path })
        if (!response.result.ok) {
          throw new Error(`spill open failed: ${response.result.error.message}`)
        }
      },
    }),
  }, PreviewTabs))
}
