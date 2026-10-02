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
import { chatHasEventsAfterSeq } from '../src/client/chat/resubmit-execute.ts'

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
