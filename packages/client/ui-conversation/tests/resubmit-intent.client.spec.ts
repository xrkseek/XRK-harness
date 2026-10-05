/**
 * Edit staging + confirm intent: edit loads the composer first; delete / send
 * confirm go through the modal.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { ConversationSnapshot } from '@xrkseek/client-runtime/client'
import {
  beginEditStaging,
  clearEditStaging,
  completeResubmitConfirm,
  getEditStaging,
  getResubmitIntent,
  peekEditStagingFor,
  requestResubmitConfirm,
  takeEditStagingFor,
} from '../src/client/chat/resubmit-intent.ts'
import {
  chatHasEventsAfterSeq,
  editResubmitNeedsConfirm,
  editResubmitSourceIsLive,
} from '../src/client/chat/resubmit-execute.ts'

afterEach(() => {
  clearEditStaging()
  if (getResubmitIntent() !== null) completeResubmitConfirm('cancel')
})

describe('edit staging', () => {
  it('beginEditStaging records session + seq without opening confirm', () => {
    beginEditStaging({ sessionId: 's1', seq: 12 })
    expect(getEditStaging()).toEqual({ sessionId: 's1', seq: 12 })
    expect(getResubmitIntent()).toBeNull()
  })

  it('peek leaves staging; take consumes matching session only', () => {
    beginEditStaging({ sessionId: 's1', seq: 3 })
    expect(peekEditStagingFor('other')).toBeNull()
    expect(peekEditStagingFor('s1')?.seq).toBe(3)
    expect(getEditStaging()?.seq).toBe(3)
    expect(takeEditStagingFor('s1')).toEqual({ sessionId: 's1', seq: 3 })
    expect(getEditStaging()).toBeNull()
  })

  it('beginEditStaging replaces a prior stage', () => {
    beginEditStaging({ sessionId: 's1', seq: 1 })
    beginEditStaging({ sessionId: 's1', seq: 9 })
    expect(getEditStaging()?.seq).toBe(9)
  })
})

describe('chatHasEventsAfterSeq', () => {
  it('is false when no later node seq exists', () => {
    const snapshot = {
      chat: {
        order: ['a'],
        nodes: new Map([['a', { data: { seq: 4 } }]]),
      },
    } as unknown as ConversationSnapshot
    expect(chatHasEventsAfterSeq(snapshot, 4)).toBe(false)
    expect(chatHasEventsAfterSeq(snapshot, 3)).toBe(true)
  })

  it('treats a later node as tail even when only anchorSeq is present', () => {
    const snapshot = {
      chat: {
        order: ['user', 'tool'],
        nodes: new Map([
          ['user', { anchorSeq: 2, data: { seq: 2 } }],
          ['tool', { anchorSeq: 5, data: {} }],
        ]),
      },
    } as unknown as ConversationSnapshot
    expect(chatHasEventsAfterSeq(snapshot, 2)).toBe(true)
  })
})

describe('editResubmitNeedsConfirm', () => {
  const idleTail = {
    running: false,
    runningCalls: [] as const,
    partial: null,
    chat: {
      order: ['a'],
      nodes: new Map([['a', { anchorSeq: 1, data: { seq: 1 } }]]),
    },
  }

  it('asks while running even with no later chat nodes', () => {
    expect(editResubmitNeedsConfirm({
      ...idleTail, running: true,
    } as unknown as ConversationSnapshot, 1)).toBe(true)
  })

  it('asks while a tool call is live even if Host running lagged off', () => {
    expect(editResubmitNeedsConfirm({
      ...idleTail,
      runningCalls: [{ callId: 'c1', name: 'bash' }],
    } as unknown as ConversationSnapshot, 1)).toBe(true)
  })

  it('asks while a streaming partial is visible', () => {
    expect(editResubmitNeedsConfirm({
      ...idleTail,
      partial: { turn: 1, step: 0, blocks: [{ kind: 'reasoning', text: '…' }] },
    } as unknown as ConversationSnapshot, 1)).toBe(true)
  })

  it('skips when idle and the edited message is the tail', () => {
    expect(editResubmitNeedsConfirm(
      idleTail as unknown as ConversationSnapshot, 1,
    )).toBe(false)
    expect(editResubmitSourceIsLive(
      idleTail as unknown as ConversationSnapshot,
    )).toBe(false)
  })
})

describe('resubmit confirm', () => {
  it('requestResubmitConfirm publishes intent until complete', async () => {
    const pending = requestResubmitConfirm({
      sessionId: 's1', kind: 'delete', seq: 4,
    })
    expect(getResubmitIntent()?.kind).toBe('delete')
    completeResubmitConfirm('keep-files')
    await expect(pending).resolves.toBe('keep-files')
    expect(getResubmitIntent()).toBeNull()
  })
})
