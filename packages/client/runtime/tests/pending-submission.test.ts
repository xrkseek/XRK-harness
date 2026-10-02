/**
 * Local submission echoes: synchronous insertion, placement from running
 * state, and abandon/observed retirement.
 */
import { describe, expect, it, vi } from 'vitest'
import { createUserMessage } from '@xrkseek/xrk-llm'
import type { IApiClient, MuxFrame, SessionId } from '@xrkseek/xrk-api-remotes/client'
import { RpcId } from '@xrkseek/xrk-host-apiproxy/api'
import { Session } from '../src/client/sessions/session.ts'
import type { SessionRemotes } from '../src/client/sessions/remotes.ts'
import { ev } from './event-script.client.ts'

const SID = 'fk-echo-1' as SessionId

function ok<T>(value: T) {
  return { rpcId: RpcId('fake'), result: { ok: true as const, value } }
}

function hold<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
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
      cancel: () => Promise.resolve(ok({ accepted: true as const })),
      history: () => Promise.resolve(ok({ events: [], hasMore: false })),
    },
    subagents: {
      prompt: () => Promise.resolve(ok({ messageId: 'm' as never })),
      history: () => Promise.resolve(ok({ events: [], hasMore: false })),
      interrupt: () => Promise.resolve(ok({ accepted: true as const })),
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

  it('starts as queued while a local turn is running (no transcript→dock flash)', () => {
    const { api } = bareApi()
    const session = new Session(SID, api, remotes())
    session.beginSubmission({ mode: 'queue', text: '空闲', attachments: [] })
    session.handleRunning(true)
    session.beginSubmission({ mode: 'queue', text: '排队', attachments: [] })
    session.beginSubmission({ mode: 'steer', text: '纠偏', attachments: [] })
    // QueueDock paints pre-admit local `queued` echoes, so busy submits can
    // dock on the first frame. Idle / Host-admits-straight-into-turn still
    // starts as `transcript` (see the first insert above before running).
    expect(session.getSnapshot().pendingSubmissions.map(({ text, placement }) => ({ text, placement }))).toEqual([
      { text: '空闲', placement: 'transcript' },
      { text: '排队', placement: 'queued' },
      { text: '纠偏', placement: 'steering' },
    ])
  })

  it('starts as queued when Host already has a backlog (no transcript→dock flash)', () => {
    const { api } = bareApi()
    const session = new Session(SID, api, remotes())
    session.handleMuxEnvelope(RpcId('q0'), queueFrame(SID, [{
      id: 'qi-0',
      rpcId: 'other-req',
      body: '已在排',
    }]))
    expect(session.getSnapshot().queue).toHaveLength(1)
    const handle = session.beginSubmission({ mode: 'queue', text: '跟进排', attachments: [] })
    expect(session.getSnapshot().pendingSubmissions).toMatchObject([{
      requestId: handle.requestId,
      placement: 'queued',
      text: '跟进排',
    }])
  })

  it('keeps idle first-send as transcript when Host briefly queues it (no dock flash)', () => {
    const { api } = bareApi()
    const session = new Session(SID, api, remotes())
    const handle = session.beginSubmission({ mode: 'queue', text: '首发', attachments: [] })
    expect(session.getSnapshot().pendingSubmissions[0]?.placement).toBe('transcript')
    session.handleMuxEnvelope(RpcId('q0'), queueFrame(SID, [{
      id: 'qi-0',
      rpcId: handle.requestId,
      body: '首发',
    }]))
    expect(session.getSnapshot().pendingSubmissions).toMatchObject([{
      requestId: handle.requestId,
      placement: 'transcript',
      text: '首发',
    }])
  })

  it('keeps a busy submit in the dock when Host never queues it', () => {
    const { api } = bareApi()
    const session = new Session(SID, api, remotes())
    session.handleRunning(true)
    const handle = session.beginSubmission({ mode: 'queue', text: '直入', attachments: [] })
    // Busy submits dock first (QueueDock paints local queued echoes). Host may
    // drain the admit straight into a turn with an empty queue frame — do not
    // promote to transcript here (that reintroduced the sent→queued flash);
    // durable `user/message` still retires the echo.
    session.handleMuxEnvelope(RpcId('q1'), queueFrame(SID, []))
    expect(session.getSnapshot().pendingSubmissions).toMatchObject([{
      requestId: handle.requestId,
      placement: 'queued',
      text: '直入',
    }])
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
    expect(session.getSnapshot().running).toBe(false)
  })

  it('accepted prompt arms running so Stop works without host/session-status', async () => {
    const { api } = bareApi()
    const session = new Session(SID, api, remotes())
    expect(session.getSnapshot().running).toBe(false)
    await session.prompt([{ type: 'text', text: 'hi' }], 'queue')
    expect(session.getSnapshot().running).toBe(true)
  })

  it('cancel clears running before the cancel RPC settles', async () => {
    const release = hold<ReturnType<typeof ok<{ accepted: true }>>>()
    const api = {
      sessions: {
        prompt: () => Promise.resolve(ok({ accepted: true as const })),
        cancel: () => release.promise,
        history: () => Promise.resolve(ok({ events: [], hasMore: false })),
      },
      subagents: {
        prompt: () => Promise.resolve(ok({ messageId: 'm' as never })),
        history: () => Promise.resolve(ok({ events: [], hasMore: false })),
      },
    } as unknown as IApiClient
    const session = new Session(SID, api, remotes())
    await session.prompt([{ type: 'text', text: 'hi' }], 'queue')
    expect(session.getSnapshot().running).toBe(true)
    const pending = session.cancel()
    expect(session.getSnapshot().running).toBe(false)
    release.resolve(ok({ accepted: true as const }))
    await expect(pending).resolves.toEqual({ ok: true, value: { accepted: true } })
    expect(session.getSnapshot().running).toBe(false)
  })

  it('turn/end on mux clears running without host/session-status', async () => {
    const { api } = bareApi()
    const session = new Session(SID, api, remotes())
    await session.open()
    await session.prompt([{ type: 'text', text: 'hi' }], 'queue')
    expect(session.getSnapshot().running).toBe(true)
    session.handleMuxEnvelope('r1' as never, {
      type: 'session/event',
      sessionId: SID,
      event: ev.turnEnd(1, 1),
    })
    expect(session.getSnapshot().running).toBe(false)
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

  it('Host FIFO claim hands queued echo to transcript (no claim→durable hole)', () => {
    const { api } = bareApi()
    const session = new Session(SID, api, remotes())
    session.handleRunning(true)
    const onRetire = vi.fn()
    const handle = session.beginSubmission({
      mode: 'queue', text: '跟进', attachments: [], onRetire,
    })
    session.handleMuxEnvelope(RpcId('q1'), queueFrame(SID, [{
      id: 'qi-1',
      rpcId: handle.requestId,
      body: '跟进',
    }]))
    expect(session.getSnapshot().pendingSubmissions[0]?.placement).toBe('queued')

    // Promote empties Host queue — keep echo as transcript until durable stamp.
    session.handleMuxEnvelope(RpcId('q2'), queueFrame(SID, []))
    expect(session.getSnapshot().queue).toEqual([])
    expect(session.getSnapshot().pendingSubmissions).toHaveLength(1)
    expect(session.getSnapshot().pendingSubmissions[0]).toMatchObject({
      requestId: handle.requestId,
      placement: 'transcript',
      text: '跟进',
    })
    expect(onRetire).not.toHaveBeenCalled()
  })

  it('explicit Host queue remove retires the admitted local echo', async () => {
    const { api } = bareApi()
    const updateQueue = vi.fn(async () => ok({ accepted: true as const }))
    const session = new Session(SID, {
      ...api,
      sessions: { ...api.sessions, updateQueue },
    }, remotes())
    session.handleRunning(true)
    const onRetire = vi.fn()
    const handle = session.beginSubmission({
      mode: 'queue', text: '哈哈', attachments: [], onRetire,
    })
    session.handleMuxEnvelope(RpcId('q1'), queueFrame(SID, [{
      id: 'qi-1',
      rpcId: handle.requestId,
      body: '哈哈',
    }]))
    const result = await session.updateQueue('qi-1' as never, { kind: 'remove' })
    expect(result.ok).toBe(true)
    expect(onRetire).toHaveBeenCalledWith({ reason: 'failed' })
    expect(session.getSnapshot().pendingSubmissions).toEqual([])
  })

  it('session/subscribed mirror clear does not retire still-queued echoes', () => {
    const { api } = bareApi()
    const session = new Session(SID, api, remotes())
    session.handleRunning(true)
    const handle = session.beginSubmission({ mode: 'queue', text: '重连', attachments: [] })
    session.handleMuxEnvelope(RpcId('q1'), queueFrame(SID, [{
      id: 'qi-1',
      rpcId: handle.requestId,
      body: '重连',
    }]))
    session.handleMuxEnvelope(RpcId('sub'), {
      type: 'session/subscribed',
      sessionId: SID,
      lastSeq: 1,
    })
    expect(session.getSnapshot().queue).toEqual([])
    expect(session.getSnapshot().pendingSubmissions.map(echo => echo.requestId)).toEqual([handle.requestId])

    session.handleMuxEnvelope(RpcId('q2'), queueFrame(SID, [{
      id: 'qi-1',
      rpcId: handle.requestId,
      body: '重连',
    }]))
    expect(session.getSnapshot().pendingSubmissions).toHaveLength(1)
    expect(session.getSnapshot().queue).toHaveLength(1)
  })
  it('turn/end keeps running when Host queue still has work', async () => {
    const { api } = bareApi()
    const session = new Session(SID, api, remotes())
    await session.open()
    session.handleRunning(true)
    const handle = session.beginSubmission({ mode: 'queue', text: 'next', attachments: [] })
    session.handleMuxEnvelope(RpcId('q1'), queueFrame(SID, [{
      id: 'qi-1',
      rpcId: handle.requestId,
      body: 'next',
    }]))
    session.handleMuxEnvelope(RpcId('ev'), {
      type: 'session/event',
      sessionId: SID,
      event: ev.turnEnd(1, 1),
    })
    expect(session.getSnapshot().running).toBe(true)
  })
})

function queueFrame(
  sessionId: SessionId,
  items: readonly { id: string; rpcId: string; body: string }[],
): MuxFrame {
  return {
    type: 'session/queue',
    sessionId,
    items: items.map(item => ({
      id: item.id as never,
      placement: 'queued' as const,
      message: createUserMessage({
        content: [{ type: 'text', text: item.body }],
        source: { kind: 'user', rpcId: item.rpcId as never },
      }),
    })),
  }
}
