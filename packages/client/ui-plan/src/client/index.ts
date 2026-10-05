/**
 * Plan control plugin, browser half: occupies the composer's named
 * `conversation.input.plan` seat with an active-state status chip, a session
 * header Status toggle (`conversation.session.header.actions`), compact
 * PresenceBall dock in `conversation.session.header.utilities` while Overview
 * is closed, and the details column with session Status (subagents · jobs ·
 * timeline · cost · channels; Face `session.status` ≡ `/status`) plus todos /
 * plan / Office tabs. Session tools (export log · open workspace in app)
 * contribute to `details.status.utilities` inside Overview — not the
 * conversation header.
 * Plan mode is entered through the command source; while the projection's
 * effective target is plan mode the chip renders and executes /plan off through
 * `command.execute`, otherwise the seat stays empty. Status loads via Face
 * unary; plan / todos ride live projections; Office reads `/office` status.
 * Spill rows in the live timeline open via Host `host.openPath`.
 * Teams Status rows: open/pause/resume (subagents.*) · cold resume ·
 * merge-to-parent via Face `worktree.merge`.
 */
import type {} from '@xrkseek/xrk-api-remotes/client'
import type { ConnectionHandle } from '@xrkseek/client-connection/client'
import type { ClientContext, SessionId } from '@xrkseek/client-runtime/client'
import { resolveWorkspacePath, routeWorkspaceOpenFile } from '@xrkseek/client-runtime/client'
import type { BoundActions } from '@xrkseek/client-ui-slots'
// Type-only: pulls the ui-conversation SlotMap merge (the input.plan seat).
import type {} from '@xrkseek/client-ui-conversation/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@xrkseek/client-locale/client'
// Type-only: pulls ctx.layout so the preview column can open and close.
import type {} from '@xrkseek/client-ui-layout/client'
// Type-only: ctx.settingsScope (Host user-settings namespaces).
import type {} from '@xrkseek/client-ui-settings/client'
// Type-only: pulls the `plan` SessionProjectionMap merge for useProjection.
import type {} from '@xrkseek/xrk-plan-mode/client'
import {
  PRESENCE_SETTINGS_NAMESPACE,
  type PresenceSettings,
} from '../presence-settings.ts'
import { PlanChip } from './PlanModeControl.tsx'
import { bindPresenceSettingsRuntime } from './PresenceBall.tsx'
import { PresenceDock } from './PresenceDock.tsx'
import { PresenceShapeRow, type PresenceShapeRowInjected } from './PresenceShapeRow.tsx'
import { PresenceSettingsRuntime } from './presence-settings-runtime.ts'
import { createPresenceShapeRowStore } from './presence-settings-store.ts'
import { PreviewOpenButton, PreviewTabs, type PreviewTabsInjected } from './PreviewTabs.tsx'
import { peekJobOutput as defaultPeekJobOutput } from './job-output-peek.ts'
import { createOverviewSessionSoftFaces } from './overview-session-faces.ts'
import { en, zh, type PlanKey } from './locales.ts'

export type { PlanKey } from './locales.ts'
export { openCanvasInOverview } from './canvas-focus.ts'

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

/** Required services: slots, commands Remote, locale, layout, workspaces, sessions, settings. */
export const inject = [
  'slots', 'remote', 'remote.commands', 'remote.changes', 'remote.canvas', 'locale', 'layout',
  'connection', 'sessions', 'workspaces', 'settingsScope',
]

/**
 * Client plugin body: register the plan chip over the command channel.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const connection = ctx.get('connection') as ConnectionHandle
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-plan: dictionaries')

  const presenceHost = ctx.settingsScope.bind<PresenceSettings>({
    namespace: PRESENCE_SETTINGS_NAMESPACE,
  })
  const presenceSettings = new PresenceSettingsRuntime(presenceHost)
  bindPresenceSettingsRuntime(presenceSettings)

  const presencePrefsStore = createPresenceShapeRowStore()
  let presencePrefsBound: BoundActions<typeof presencePrefsStore> | undefined
  const syncPresencePrefs = (): void => {
    presencePrefsBound?.sync(
      presenceSettings.getShape(),
      presenceSettings.getColor(),
      presenceSettings.getKit(),
      presenceSettings.getRevision(),
    )
  }
  presenceSettings.subscribe(() => { syncPresencePrefs() })
  const presencePrefsInjected = (
    actions: BoundActions<typeof presencePrefsStore>,
  ): PresenceShapeRowInjected => {
    presencePrefsBound = actions
    syncPresencePrefs()
    return {
      setShape: (shape) => { presenceSettings.setShape(shape) },
      setColor: (color) => { presenceSettings.setColor(color) },
      setKit: (kit) => { presenceSettings.setKit(kit) },
    }
  }
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'presence-shape',
    order: 12,
    store: presencePrefsStore,
    locale: NS,
    inject: presencePrefsInjected,
  }, PresenceShapeRow))

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

  // Header action (not composer.dock): Status sits with Files / Jobs so the
  // composer foot stays for live stats only — less bottom chrome, clearer IA.
  ctx.slots.inject(
    'conversation.session.header.actions',
    () => ctx.slots.register({
      name: 'conversation.session.header.actions',
      id: 'preview',
      // After workbench (25): Status is session inspect, Files is workspace.
      order: 30,
      locale: NS,
      inject: () => ({
        openPreview: () => { ctx.layout.openDetails() },
        closePreview: () => { ctx.layout.closeDetails() },
      }),
    }, PreviewOpenButton),
    'ui-plan: status header toggle',
  )

  // Compact emotion ball on the main header while Overview is closed; the
  // details rail takes over when the column opens (single WebGL instance).
  ctx.slots.inject(
    'conversation.session.header.utilities',
    () => ctx.slots.register({
      name: 'conversation.session.header.utilities',
      id: 'presence',
      order: 10,
      locale: NS,
      inject: (sessionId: SessionId) => {
        const soft = createOverviewSessionSoftFaces(
          sessionId,
          (id) => ctx.sessions.binding(id),
        )
        return { presenceCues: soft.presenceCues }
      },
    }, PresenceDock),
    'ui-plan: presence dock',
  )

  ctx.slots.inject('details', () => ctx.slots.register({
    name: 'details',
    locale: NS,
    children: {
      'details.status.utilities': { kind: 'list', scope: 'session' },
    },
    inject: (sessionId: SessionId) => ({
      closeDetails: () => { ctx.layout.closeDetails() },
      openSpillPath: async (path: string) => {
        const response = await connection.api.host.openPath({ path })
        if (!response.result.ok) {
          throw new Error(`spill open failed: ${response.result.error.message}`)
        }
      },
      peekJobOutput: (jobId: string) => defaultPeekJobOutput(jobId),
      killJob: (jobId: string) => {
        void ctx.sessions.binding(sessionId)?.session.killJob(jobId)
      },
      loadFileDiff: async (seq: number, index: number, signal: AbortSignal) => {
        const result = await ctx.remote.changes.fileDiff(
          { sessionId, seq, index },
          signal,
        )
        if (!result.ok) {
          throw new Error(result.error.message)
        }
        return result.value.diff
      },
      openChangedFile: async (path: string) => {
        const cwd = ctx.sessions.list.getSnapshot().byId[sessionId]?.cwd
        const resolved = resolveWorkspacePath(cwd, path)
        // Same contract as chat openFile: wake xrkh-better-sidebar when present,
        // else (and always after wake) Host openPath / OS.
        await routeWorkspaceOpenFile(
          resolved,
          async (p) => {
            const response = await connection.api.host.openPath({ path: p })
            if (!response.result.ok) {
              throw new Error(`path open failed: ${response.result.error.message}`)
            }
          },
          (p) => {
            // type editor → community side workbench (never bottom pane).
            const face = ctx.get('betterSidebar') as {
              openTab?(seed: { type: string; path?: string }): void
            } | undefined
            face?.openTab?.({ type: 'editor', path: p })
          },
        )
      },
      listCanvases: async (signal: AbortSignal) => {
        const result = await ctx.remote.canvas.list({ sessionId }, signal)
        if (!result.ok) throw new Error(result.error.message)
        return result.value
      },
      getCanvas: async (id: string, signal: AbortSignal) => {
        const result = await ctx.remote.canvas.get({ sessionId, id }, signal)
        if (!result.ok) throw new Error(result.error.message)
        return result.value.canvas
      },
      // Soft face: deliverables may load after plan; resolve live on each call.
      changesReview: {
        getSnapshot: () => {
          const face = ctx.get('changesReview') as PreviewTabsInjected['changesReview'] | undefined
          return face?.getSnapshot() ?? null
        },
        subscribe: (listener) => {
          const face = ctx.get('changesReview') as PreviewTabsInjected['changesReview'] | undefined
          return face?.subscribe(listener) ?? (() => {})
        },
      },
      ...createOverviewSessionSoftFaces(sessionId, (id) => ctx.sessions.binding(id)),
      openTeamChild: async (input: {
        readonly parentSessionId: string
        readonly childSessionId: string
        readonly mode?: 'continuable' | 'one-shot'
      }) => {
        const parentSessionId = input.parentSessionId as SessionId
        const childSessionId = input.childSessionId as SessionId
        const mode = input.mode === 'one-shot' ? 'one-shot' as const : 'continuable' as const
        await ctx.sessions.refreshSubagents(parentSessionId)
        try {
          ctx.sessions.openSubagent({ parentSessionId, childSessionId, mode })
        } catch {
          // Catalog may not have listed the child yet — open by id when known.
          ctx.sessions.open(childSessionId)
        }
      },
      pauseTeamChild: async (input: {
        readonly parentSessionId: string
        readonly childSessionId: string
      }) => {
        const response = await connection.api.subagents.interrupt({
          parentSessionId: input.parentSessionId as SessionId,
          childSessionId: input.childSessionId as SessionId,
          mode: 'continuable',
          takeover: true,
        })
        if (!response.result.ok) {
          throw new Error(`team pause failed: ${response.result.error.message}`)
        }
      },
      resumeTeamChild: async (input: {
        readonly parentSessionId: string
        readonly childSessionId: string
      }) => {
        const response = await connection.api.subagents.prompt({
          parentSessionId: input.parentSessionId as SessionId,
          childSessionId: input.childSessionId as SessionId,
          mode: 'continuable',
          delivery: 'queue',
          content: [{ type: 'text', text: 'Resume after human takeover.' }],
        })
        if (!response.result.ok) {
          throw new Error(`team resume failed: ${response.result.error.message}`)
        }
      },
      mergeTeamWorktree: async (input: {
        readonly leaseId: string
        readonly pruneAfter?: boolean
      }) => {
        const response = await fetch('/api/worktree.merge', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            type: 'client-request',
            rpcId: `team-merge-${Date.now()}`,
            payload: {
              leaseId: input.leaseId,
              ...(input.pruneAfter === false ? {} : { pruneAfter: true }),
            },
          }),
        })
        const body = await response.json() as {
          result?: {
            ok?: boolean
            error?: { message?: string }
            value?: { merged?: boolean; reason?: string }
          }
        }
        if (!body.result?.ok) {
          throw new Error(
            body.result?.error?.message
              ?? `team worktree merge failed for ${input.leaseId}`,
          )
        }
        if (body.result.value && body.result.value.merged === false) {
          throw new Error(
            body.result.value.reason
              ?? `worktree merge retained lease ${input.leaseId}`,
          )
        }
      },
    }),
  }, PreviewTabs))
}
