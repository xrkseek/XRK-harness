/**
 * Deliverables plugin, browser half: changed-files card + produced-files row
 * on `conversation.chat.turnTail`, and `chatFileMentions` for closing prose.
 * Also provides `ctx.changesReview` so Status can host a persistent Changes tab.
 */
import type { ConnectionHandle } from '@xrkseek/client-connection/client'
import type { ClientContext } from '@xrkseek/client-runtime/client'
import { resolveWorkspacePath } from '@xrkseek/client-runtime/client'
import type { ChatFileMentions } from '@xrkseek/client-ui-conversation/client'
import type {} from '@xrkseek/client-locale/client'
import type {} from '@xrkseek/client-ui-layout/client'
import type {} from '@xrkseek/xrk-api-remotes/client'
import { DeliverablesTail, type DeliverablesInjected } from './Deliverables.tsx'
import { ChangesReviewController } from './changes-review-controller.ts'
import { en, NS, zh, type DeliverablesKey } from './locales.ts'
import {
  deliverablesDefinition, producedFileMentions, selectDeliverables,
} from './turn-deliverables.ts'
import './workspace-changes-projection.ts'

declare module '@xrkseek/cordis' {
  interface Context {
    changesReview: ChangesReviewController
  }
}

declare module '@xrkseek/client-ui-slots' {
  interface LocaleNamespaceMap {
    'deliverables': DeliverablesKey
  }
}

export { ProducedFiles, type ProducedFilesProps } from './ProducedFiles.tsx'
export { ChangedFiles } from './ChangedFiles.tsx'
export { ChangesReviewView } from './ChangesReviewView.tsx'
export { ChangesReviewController } from './changes-review-controller.ts'
export { diffHunkFromWorkspaceFileDiff } from './workspace-file-diff-hunk.ts'
export { DeliverablesTail, selectDeliverables } from './Deliverables.tsx'
export {
  producedForClosing, changesForClosing, collectChangesTurnsFromTimeline,
  fileLanesForClosing, foldFileLanes,
} from './turn-deliverables.ts'

export const inject = [
  'slots', 'locale', 'conversationEvents', 'connection', 'sessions',
  'workspaces', 'remote', 'remote.changes', 'layout',
]

export function apply(ctx: ClientContext): void {
  const connection = ctx.get('connection') as ConnectionHandle
  const changesReview = new ChangesReviewController()
  ctx.provide('changesReview', changesReview)
  ctx.conversationEvents.register(deliverablesDefinition)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-deliverables: dictionaries')
  ctx.slots.inject(
    'conversation.chat.turnTail',
    () => ctx.slots.register({
      name: 'conversation.chat.turnTail',
      select: selectDeliverables,
      locale: NS,
      inject: (sessionId): DeliverablesInjected => {
        const openNativePath = async (
          path: string,
          options?: { readonly reveal?: boolean },
        ): Promise<void> => {
          const snap = ctx.sessions.list.getSnapshot()
          const cwd = snap.current === undefined
            ? undefined
            : snap.byId[snap.current]?.cwd
          const response = await connection.api.host.openPath({
            path: resolveWorkspacePath(cwd, path),
            ...(options?.reveal === true ? { reveal: true } : {}),
          })
          if (!response.result.ok) {
            throw new Error(`path open failed: ${response.result.error.message}`)
          }
        }
        return {
          isLoopback: connection.isLoopback,
          openNativePath,
          // Prefer workspaces.openPath('.') so xrkh-better-sidebar can
          // intercept the folder gesture; without the plugin, Host Explorer
          // opens the absolute workspace root (same as openNativePath reveal).
          showInFolder: async () => {
            const sidebar = ctx.get('betterSidebar') as unknown
            if (sidebar != null) {
              await ctx.workspaces.openPath('.')
              return
            }
            await openNativePath('.', { reveal: true })
          },
          hooks: { hostDescription: connection.hostDescription },
          loadFileDiff: async (seq, index, signal) => {
            const result = await ctx.remote.changes.fileDiff(
              { sessionId, seq, index },
              signal,
            )
            if (!result.ok) {
              throw new Error(result.error.message)
            }
            return result.value.diff
          },
          openOverviewReview: (index, seq) => {
            changesReview.open({ sessionId, seq, index })
            ctx.layout.openDetails()
          },
        }
      },
    }, DeliverablesTail),
  )
  const t = ctx.locale.bind(NS)
  const mentions: ChatFileMentions = {
    forClosing(owner) {
      const matched = selectDeliverables(owner)
      if (matched === null) return undefined
      // Mentions resolve created + modified (deleted paths stay inert).
      const paths = [...matched.lanes.created, ...matched.lanes.modified]
      const fallback = paths.length > 0
        ? paths
        : matched.changes?.files.map(f => f.path) ?? []
      if (fallback.length === 0) return undefined
      return producedFileMentions(fallback, owner.openFile, path => t('produced.open', { name: path }))
    },
  }
  ctx.provide('chatFileMentions', mentions)
}
