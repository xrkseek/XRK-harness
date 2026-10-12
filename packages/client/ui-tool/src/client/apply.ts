/** Register the Tool call tree, details renderer, and built-in atomic views. */
import type { ConnectionHandle } from '@xrkseek/client-connection/client'
import type { ClientContext } from '@xrkseek/client-runtime/client'
import type {} from '@xrkseek/client-ui-conversation/client'
import { ToolCallTree } from './tool/ToolCallTree.tsx'
import { CONVERSATION_NS as NS } from './locale.ts'
import { askQuestionToolview } from './tool/toolviews/ask-question-row.tsx'
import { bashToolviewSample } from './tool/toolviews/bash-sample.tsx'
import { fileMutationToolview } from './tool/toolviews/file-mutation-row.tsx'
import { imageGenToolview } from './tool/toolviews/image-gen-row.tsx'
import { presentToolview } from './tool/toolviews/present-row.tsx'
import { readToolview } from './tool/toolviews/read-row.tsx'
import { readImageToolview } from './tool/toolviews/read-image-row.tsx'
import { searchToolview } from './tool/toolviews/search-row.tsx'
import { todoToolview } from './tool/toolviews/todo-row.tsx'
import { videoGenToolview } from './tool/toolviews/video-gen-row.tsx'
import { webToolview } from './tool/toolviews/web-row.tsx'

/**
 * Required services: slot registry, connection Host facts for POSIX `~`, and
 * ui-conversation's live tools-default-expanded store. Waiting on
 * `conversationUiPrefs` (not only package prefetch) prevents an orphan
 * SnapshotStore that Settings never writes.
 */
export const inject = ['slots', 'connection', 'conversationUiPrefs']

/**
 * Mount the whole-Tool renderers and built-in atomic Tool registrations.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  const connection = ctx.get('connection') as ConnectionHandle
  // Guaranteed by inject — same store Settings writes through submissionPolicy.
  const { toolsDefaultExpanded } = ctx.conversationUiPrefs
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'tool-call',
    locale: NS,
    children: {
      'tool.call.toolview': { kind: 'keyed', scope: 'session' },
      // Sole declaration for media holes (GenericToolCard + image/video rows).
      // Keyed toolviews must not re-declare these — SlotCore allows one owner.
      'tool.call.images': { kind: 'single', scope: 'session' },
      'tool.call.files': { kind: 'single', scope: 'session' },
    },
    inject: () => ({
      hooks: {
        hostDescription: connection.hostDescription,
        toolsDefaultExpanded,
      },
    }),
  }, ToolCallTree))

  // conversation.details.tool / ToolDetails registration removed: the right
  // Detail column is demoted; inspect stays on trajectory; file open wakes
  // community better-sidebar then `workspaces.openPath`
  // (see routeChatOpenFile in ui-conversation).

  ctx.plugin(bashToolviewSample)
  ctx.plugin(readToolview)
  ctx.plugin(readImageToolview)
  ctx.plugin(imageGenToolview)
  ctx.plugin(videoGenToolview)
  ctx.plugin(fileMutationToolview)
  ctx.plugin(presentToolview)
  ctx.plugin(searchToolview)
  ctx.plugin(webToolview)
  ctx.plugin(todoToolview)
  ctx.plugin(askQuestionToolview)
}
