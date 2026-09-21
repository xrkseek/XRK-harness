/**
 * Deliverables plugin, browser half: changed-files card + produced-files row
 * on `conversation.chat.turnTail`, and `chatFileMentions` for closing prose.
 */
import type { ConnectionHandle } from '@xrkseek/client-connection/client'
import type { ClientContext } from '@xrkseek/client-runtime/client'
import { resolveWorkspacePath } from '@xrkseek/client-runtime/client'
import type { ChatFileMentions } from '@xrkseek/client-ui-conversation/client'
import type {} from '@xrkseek/client-locale/client'
import type {} from '@xrkseek/xrk-api-remotes/client'
import { DeliverablesTail, type DeliverablesInjected } from './Deliverables.tsx'
import { en, NS, zh, type DeliverablesKey } from './locales.ts'
import {
  deliverablesDefinition, producedFileMentions, selectDeliverables,
} from './turn-deliverables.ts'
import './workspace-changes-projection.ts'

declare module '@xrkseek/client-ui-slots' {
  interface LocaleNamespaceMap {
    'deliverables': DeliverablesKey
  }
}

export { ProducedFiles, type ProducedFilesProps } from './ProducedFiles.tsx'
export { ChangedFiles } from './ChangedFiles.tsx'
export { diffHunkFromWorkspaceFileDiff } from './workspace-file-diff-hunk.ts'
export { DeliverablesTail, selectDeliverables } from './Deliverables.tsx'
export { producedForClosing, changesForClosing } from './turn-deliverables.ts'

export const inject = [
  'slots', 'locale', 'conversationEvents', 'connection', 'sessions',
  'remote', 'remote.changes',
]

export function apply(ctx: ClientContext): void {
  const connection = ctx.get('connection') as ConnectionHandle
  ctx.conversationEvents.register(deliverablesDefinition)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-deliverables: dictionaries')
  ctx.slots.inject(
    'conversation.chat.turnTail',
    () => ctx.slots.register({
      name: 'conversation.chat.turnTail',
      select: selectDeliverables,
      locale: NS,
      inject: (): DeliverablesInjected => ({
        isLoopback: connection.isLoopback,
        openNativePath: async (path: string, options?: { readonly reveal?: boolean }) => {
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
        },
        hooks: { hostDescription: connection.hostDescription },
        loadFileDiff: async (seq, index, signal) => {
          const sessionId = ctx.sessions.list.getSnapshot().current
          if (sessionId === undefined) return null
          const result = await ctx.remote.changes.fileDiff(
            { sessionId, seq, index },
            signal,
          )
          if (!result.ok) {
            throw new Error(result.error.message)
          }
          return result.value.diff
        },
      }),
    }, DeliverablesTail),
  )
  const t = ctx.locale.bind(NS)
  const mentions: ChatFileMentions = {
    forClosing(owner) {
      const matched = selectDeliverables(owner)
      if (matched === null) return undefined
      const paths = matched.produced.length > 0
        ? matched.produced
        : matched.changes?.files.map(f => f.path) ?? []
      if (paths.length === 0) return undefined
      return producedFileMentions(paths, owner.openFile, path => t('produced.open', { name: path }))
    },
  }
  ctx.provide('chatFileMentions', mentions)
}
