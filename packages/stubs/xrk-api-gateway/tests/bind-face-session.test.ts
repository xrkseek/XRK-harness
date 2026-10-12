import { Context } from '@xrkseek/cordis'
import { describe, expect, it, vi } from 'vitest'
import { FaceClientRemote } from '../src/client/index.ts'

describe('$bindFace session', () => {
  it('provides Cordis remote.session and calls Face dotted endpoints', async () => {
    const calls: Array<{ endpoint: string; args: Record<string, unknown> }> = []
    const root = new Context()
    root.provide('typert', {})
    root.provide('connection', {
      rpc: {
        call: async (_channel: string, endpoint: string, payload: { args: Record<string, unknown> }) => {
          calls.push({ endpoint, args: payload.args })
          return { ok: true, value: { sessions: [] } }
        },
      },
    })
    const remote = new FaceClientRemote(root)
    await remote.$bindFace({
      session: {
        list: 'args',
        create: 'args',
      },
      commands: {
        list: ['agentId'],
      },
    })

    const session = root.get('remote.session') as {
      list: (args?: Record<string, unknown>) => Promise<{ ok: boolean; value: unknown }>
    }
    expect(session).toBeDefined()
    expect(typeof session.list).toBe('function')

    const listed = await session.list({})
    expect(listed.ok).toBe(true)
    expect(calls).toContainEqual({ endpoint: 'session.list', args: {} })

    const commands = root.get('remote.commands') as {
      list: (agentId: string) => Promise<{ ok: boolean; value: unknown }>
    }
    await commands.list('sess-1')
    expect(calls).toContainEqual({
      endpoint: 'commands/list',
      args: { agentId: 'sess-1' },
    })

    await vi.waitFor(() => {
      expect(root.get('remote.session')).toBeDefined()
    })
  })
})
