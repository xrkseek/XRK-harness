/**
 * Local submission echoes: synchronous insertion, placement from running
 * state, and abandon/observed retirement.
 */
import { describe, expect, it, vi } from 'vitest'
import type { IApiClient, SessionId } from '@xrkseek/xrk-api-remotes/client'
import { RpcId } from '@xrkseek/xrk-host-apiproxy/api'
import { Session } from '../src/client/sessions/session.ts'
import type { SessionRemotes } from '../src/client/sessions/remotes.ts'

const SID = 'fk-echo-1' as SessionId

function ok<T>(value: T) {
  return { rpcId: RpcId('fake'), result: { ok: true as const, value } }
}

function bareApi(onPrompt?: (payload: unknown) => Promise<unknown>): {
  api: IApiClient
  prompts: unknown[]
} {
  const prompts: unknown[] = []
  const api = {
    sessions: {
      prompt: (payload: unknown) => {
        prompts.push(payload)
        return onPrompt?.(payload) ?? Promise.resolve(ok({ accepted: true as const }))
      },
      history: () => Promise.resolve(ok({ events: [], hasMore: false })),
    },
    subagents: {
      prompt: () => Promise.resolve(ok({ messageId: 'm' as never })),
      history: () => Promise.resolve(ok({ events: [], hasMore: false })),
    },
  } as unknown as IApiClient
  return { api, prompts }
}

function remotes(): SessionRemotes {
  return {
    session: {} as never,
    subagents: {} as never,
  }
}

describe('beginSubmission', () => {
  it('inserts the echo synchronously before any prompt call', () => {
    const { api, prompts } = bareApi()
    const session = new Session(SID, api, remotes())
    expect(session.getSnapshot().pendingSubmissions).toEqual([])
    const handle = session.beginSubmission({
      mode: 'queue',
      text: '你好',
      attachments: [{
        type: 'image',
        value: { previewUrl: 'blob:p1', name: 'a.png', width: 4, height: 3 },
      }],
    })
    expect(prompts).toEqual([])
    expect(session.getSnapshot().pendingSubmissions).toMatchObject([{
      requestId: handle.requestId,
      placement: 'transcript',
      text: '你好',
      attachments: [{
        type: 'image',
        value: { previewUrl: 'blob:p1', name: 'a.png', width: 4, height: 3 },
      }],
    }])
  })

  it('derives placement from running state and delivery mode', () => {
    const { api } = bareApi()
    const session = new Session(SID, api, remotes())
    session.beginSubmission({ mode: 'queue', text: '空闲', attachments: [] })
    session.handleRunning(true)
    session.beginSubmission({ mode: 'queue', text: '排队', attachments: [] })
    session.beginSubmission({ mode: 'steer', text: '纠偏', attachments: [] })
    expect(session.getSnapshot().pendingSubmissions.map(({ text, placement }) => ({ text, placement }))).toEqual([
      { text: '空闲', placement: 'transcript' },
      { text: '排队', placement: 'queued' },
      { text: '纠偏', placement: 'steering' },
    ])
  })

  it('abandon retires the echo as failed exactly once', () => {
    const { api } = bareApi()
    const session = new Session(SID, api, remotes())
    const retirements: unknown[] = []
    const handle = session.beginSubmission({
      mode: 'queue',
      text: '放弃',
      attachments: [],
      onRetire: retirement => retirements.push(retirement),
    })
    handle.abandon()
    handle.abandon()
    expect(session.getSnapshot().pendingSubmissions).toEqual([])
    expect(retirements).toEqual([{ reason: 'failed' }])
  })

  it('failed prompt retires the identified echo', async () => {
    const { api } = bareApi(() => Promise.resolve({
      rpcId: RpcId('r'),
      result: { ok: false as const, error: { code: 'agent-busy', message: 'busy', details: {} } },
    }))
    const session = new Session(SID, api, remotes())
    const handle = session.beginSubmission({ mode: 'queue', text: '失败', attachments: [] })
    const result = await session.prompt([{ type: 'text', text: '失败' }], 'queue', undefined, handle.requestId)
    expect(result.ok).toBe(false)
    expect(session.getSnapshot().pendingSubmissions).toEqual([])
  })

  it('passes requestId through to session.prompt', async () => {
    const { api, prompts } = bareApi()
    const session = new Session(SID, api, remotes())
    const handle = session.beginSubmission({ mode: 'queue', text: '带 id', attachments: [] })
    await session.prompt([{ type: 'text', text: '带 id' }], 'queue', undefined, handle.requestId)
    expect(prompts[0]).toMatchObject({ requestId: handle.requestId, sessionId: SID })
  })

  it('dispose retires unsettled echoes as failed', () => {
    const { api } = bareApi()
    const session = new Session(SID, api, remotes())
    const onRetire = vi.fn()
    session.beginSubmission({ mode: 'queue', text: 'dispose', attachments: [], onRetire })
    session.dispose()
    expect(session.getSnapshot().pendingSubmissions).toEqual([])
    expect(onRetire).toHaveBeenCalledWith({ reason: 'failed' })
  })
})
