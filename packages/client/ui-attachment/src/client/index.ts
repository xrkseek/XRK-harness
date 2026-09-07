/** Browser attachment plugin: fills conversation's composer and message-image slots. */
import type { ClientContext } from '@xrkseek/client-runtime/client'
import type {} from '@xrkseek/client-ui-conversation/client'
import type {} from '@xrkseek/client-ui-tool/client'
import { ComposerAttachments } from './ComposerAttachments.tsx'
import { MessageImages } from './MessageImages.tsx'

/** Slot registry required by this presentation plugin. */
export const inject = ['slots']

/** Register attachment presentation without exporting React components as package values. */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('conversation.input.attachments', () => ctx.slots.register({
    name: 'conversation.input.attachments',
    locale: 'conversation',
  }, ComposerAttachments))
  ctx.slots.inject('conversation.message.images', () => ctx.slots.register({
    name: 'conversation.message.images',
    locale: 'conversation',
  }, MessageImages))
  // Tool image gallery reuses the message gallery renderer (same owner shape).
  ctx.slots.inject('tool.call.images', () => ctx.slots.register({
    name: 'tool.call.images',
    locale: 'conversation',
  }, MessageImages))
}
