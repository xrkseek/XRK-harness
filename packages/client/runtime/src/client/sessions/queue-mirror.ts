import type { ContentBlock } from '@xrkseek/xrk-llm/types'
import type { MuxFrame, RpcId } from '@xrkseek/xrk-api-remotes/client'
import type { SessionEvent } from '@xrkseek/xrk-session/types'
import type { QueuedMessage } from './conversation.ts'

const QUEUE_PREVIEW_CHARS = 200

function previewOf(content: readonly ContentBlock[]): string {
  const flat = content
    .map(block => (block.type === 'text' ? block.text : `[${block.type}]`))
    .join(' ').replace(/\s+/g, ' ').trim()
  const chars = Array.from(flat)
  return chars.length > QUEUE_PREVIEW_CHARS ? `${chars.slice(0, QUEUE_PREVIEW_CHARS).join('')}…` : flat
}

function textOf(content: readonly ContentBlock[]): string {
  return content
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join('')
}

type QueueItems = Extract<MuxFrame, { type: 'session/queue' }>['items']

/** Authoritative transient queue projection and durable steering handoff. */
export class SessionQueueMirror {
  private current: readonly QueuedMessage[] = []

  /**
   * Return the current immutable queue projection.
   * @returns current queue rows.
   */
  snapshot(): readonly QueuedMessage[] {
    return this.current
  }

  /**
   * Drop the stale generation before its replacement queue baseline arrives.
   * @returns whether any projected queue row was removed.
   */
  reset(): boolean {
    if (this.current.length === 0) return false
    this.current = []
    return true
  }

  /**
   * Replace from one authoritative stream queue frame.
   *
   * Attachment blocks are re-spread on every frame, so a naive map hands React a
   * new object identity each push. `MessageImage` keys its load effect on the
   * attachment identity, so that re-arms the effect — a pending thumbnail drops
   * back to its loading state on every queue publish. Carry the previous block
   * forward whenever its `attachmentId` still matches.
   *
   * @param items - complete host queue snapshot.
   */
  replace(items: QueueItems): void {
    const previous = new Map<string, ContentBlock>()
    for (const row of this.current) {
      for (const block of row.content) {
        const attachmentId = (block as { readonly attachment?: { readonly attachmentId?: unknown } })
          .attachment?.attachmentId
        if (typeof attachmentId === 'string') {
          previous.set(`${block.type}:${attachmentId}`, block)
        }
      }
    }
    this.current = items.map(item => {
      const source = item.message.source as { readonly kind?: unknown; readonly rpcId?: unknown } | undefined
      const rpcId = source?.kind === 'user' && typeof source.rpcId === 'string'
        ? source.rpcId as RpcId
        : undefined
      const content = item.message.content.map((block) => {
        if (block.type !== 'image' && block.type !== 'file') return block
        const attachmentId = block.attachment?.attachmentId
        if (attachmentId === undefined) return block
        const carried = previous.get(`${block.type}:${attachmentId}`)
        if (carried === undefined || carried.type !== block.type) return block
        return carried as typeof block
      })
      return {
        id: item.id,
        messageId: item.message.id,
        placement: item.placement,
        content,
        preview: previewOf(content),
        text: textOf(content),
        ...(rpcId === undefined ? {} : { rpcId }),
      }
    })
  }

  /**
   * Retire a transient steering row once its durable message enters the log.
   *
   * A steering row's `messageId` is its admitId — the Host promotes the admit
   * into a fresh `user/message` id, so comparing ids never matches and the row
   * lingered until the next queue publish. Match the row's prompt rpcId (the
   * source echo the durable event carries) so the row leaves in the same beat
   * its durable node arrives, and its local echo is never left painting alone.
   *
   * @param event - newly contiguous durable Session event.
   * @returns whether the projection changed.
   */
  acceptDurable(event: SessionEvent): boolean {
    if (event.type !== 'user/message') return false
    const data = event.data as {
      readonly id?: unknown
      readonly source?: { readonly kind?: unknown; readonly rpcId?: unknown }
      readonly rpcId?: unknown
    }
    const source = data.source
    const rpcId = (source?.kind === 'user' && typeof source.rpcId === 'string')
      ? source.rpcId
      : (typeof data.rpcId === 'string' ? data.rpcId : undefined)
    const index = this.current.findIndex(item => {
      if (item.placement !== 'steering') return false
      if (rpcId !== undefined && item.rpcId !== undefined) return item.rpcId === rpcId
      return item.messageId === data.id
    })
    if (index < 0) return false
    this.current = this.current.filter((_item, candidate) => candidate !== index)
    return true
  }
}
