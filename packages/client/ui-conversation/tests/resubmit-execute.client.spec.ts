// @vitest-environment jsdom

// Edit-resubmit execution: the truncate result is a value, not a throw. A
// failed cut must stop before the re-prompt (otherwise the old turn and the
// edited message both survive) and must surface in the composer strip.

import { describe, expect, it, vi } from 'vitest'
import type { ISessions } from '@xrkseek/client-runtime/client'
import { executeResubmitAfterChoice } from '../src/client/chat/resubmit-execute.ts'

const SID = 's1'

function makeSessions(opts: {
  readonly truncateOk?: boolean
  readonly live?: boolean
  /** `/rollback` outcome: restored, no such command on this face, or failed. */
  readonly rollback?: 'ok' | 'unmatched' | 'failed'
} = { truncateOk: true }) {
  const prompt = vi.fn(async () => ({ ok: true as const, value: { accepted: true as const } }))
  const reportError = vi.fn()
  const command = vi.fn(async () =>
    opts.rollback === 'failed'
      ? {
        ok: false as const,
        error: { code: 'rollback-failed' as const, message: 'checkpoint missing' },
      }
      : { ok: true as const, value: { matched: opts.rollback !== 'unmatched' } },
  )
  const cancel = vi.fn(async () => ({ ok: true as const, value: { accepted: true as const } }))
  const truncate = vi.fn(async () =>
    opts.truncateOk !== false
      ? { ok: true as const, value: { sessionId: SID, eventCount: 3 } }
      : { ok: false as const, error: { code: 'truncate-failed' as const, message: 'cut failed' } },
  )
  const session = {
    prompt,
    reportError,
    command,
    cancel,
    getSnapshot: () => ({
      running: opts.live === true,
      runningCalls: [],
      partial: null,
    }),
  }
  const sessions = {
    binding: () => ({ session }),
    truncate,
  }
  return {
    sessions: sessions as unknown as ISessions,
    prompt,
    reportError,
    command,
    cancel,
    truncate,
  }
}

describe('executeResubmitAfterChoice', () => {
  it('stops before the re-prompt when the cut fails, and reports it', async () => {
    const s = makeSessions({ truncateOk: false })

    await executeResubmitAfterChoice(s.sessions, SID, {
      seq: 5,
      choice: 'keep-files',
      text: 'edited',
    })

    expect(s.truncate).toHaveBeenCalledWith({ sessionId: SID, beforeSeq: 4 })
    expect(s.prompt).not.toHaveBeenCalled()
    expect(s.reportError).toHaveBeenCalledWith('resubmit', {
      code: 'truncate-failed',
      message: 'cut failed',
    })
  })

  it('re-prompts after a successful cut', async () => {
    const s = makeSessions()

    await executeResubmitAfterChoice(s.sessions, SID, {
      seq: 5,
      choice: 'keep-files',
      text: 'edited',
    })

    expect(s.truncate).toHaveBeenCalledWith({ sessionId: SID, beforeSeq: 4 })
    expect(s.prompt).toHaveBeenCalledTimes(1)
    expect(s.reportError).not.toHaveBeenCalled()
  })

  it('does not re-prompt on the delete path', async () => {
    const s = makeSessions()

    await executeResubmitAfterChoice(s.sessions, SID, { seq: 5, choice: 'keep-files' })

    expect(s.truncate).toHaveBeenCalledTimes(1)
    expect(s.prompt).not.toHaveBeenCalled()
  })

  it('rolls the workspace back before cutting, and cancels a live turn', async () => {
    const s = makeSessions({ live: true })

    await executeResubmitAfterChoice(s.sessions, SID, {
      seq: 7,
      choice: 'revert-files',
      text: 'edited',
    })

    expect(s.command).toHaveBeenCalledWith('/rollback seq:7')
    expect(s.cancel).toHaveBeenCalledTimes(1)
    // rollback → cancel → truncate ordering matters: the rollback needs the
    // pre-cut seq to address its checkpoint.
    const order = [
      s.command.mock.invocationCallOrder[0]!,
      s.cancel.mock.invocationCallOrder[0]!,
      s.truncate.mock.invocationCallOrder[0]!,
    ]
    expect(order).toEqual([...order].sort((a, b) => a - b))
  })

  // "Revert the files" that silently reverts nothing is worse than refusing:
  // the conversation would be cut while the workspace stayed behind, and the
  // user would be told neither half. Stop before the cut and name the reason.
  it('keeps the conversation when the workspace cannot roll back', async () => {
    const s = makeSessions({ live: true, rollback: 'failed' })

    await executeResubmitAfterChoice(s.sessions, SID, {
      seq: 7,
      choice: 'revert-files',
      text: 'edited',
    })

    expect(s.command).toHaveBeenCalledWith('/rollback seq:7')
    expect(s.truncate).not.toHaveBeenCalled()
    expect(s.prompt).not.toHaveBeenCalled()
    expect(s.reportError).toHaveBeenCalledWith(
      'resubmit',
      expect.objectContaining({
        message: expect.stringContaining('checkpoint missing'),
      }),
    )
  })

  it('treats a face without /rollback as a failed revert', async () => {
    const s = makeSessions({ rollback: 'unmatched' })

    await executeResubmitAfterChoice(s.sessions, SID, {
      seq: 3,
      choice: 'revert-files',
    })

    expect(s.truncate).not.toHaveBeenCalled()
    expect(s.reportError).toHaveBeenCalledTimes(1)
  })
})
