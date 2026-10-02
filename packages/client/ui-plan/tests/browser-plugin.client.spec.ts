/**
 * ui-plan browser half on a real SlotRegistry: the plugin occupies the
 * conversation-declared `conversation.input.plan` single seat with the active
 * plan status chip; the injected face executes /plan off and folds admission
 * outcomes into null (admitted) or a user-visible failure line; teardown
 * empties the seat (HMR safety).
 */
import { Context } from '@xrkseek/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@xrkseek/client-runtime/client'
import type { SessionId } from '@xrkseek/client-runtime/client'
import { LocaleRuntime } from '@xrkseek/client-locale/client'
import { PlanChip } from '../src/client/PlanModeControl.tsx'
import type { PlanChipInjected } from '../src/client/index.ts'
import { apply, inject } from '../src/client/index.ts'
import { apply as nodeApply } from '../src/index.ts'

const SID = 's-plan' as SessionId

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  slots.register({
    name: 'root',
    children: {
      'conversation.input.plan': { kind: 'single', scope: 'session' },
      'conversation.session.header.actions': { kind: 'list', scope: 'session' },
      'conversation.session.header.utilities': { kind: 'list', scope: 'session' },
      'details': { kind: 'single', scope: 'session' },
    },
  } as never, () => null)
  const execute = vi.fn((_sessionId: SessionId, _line: string) =>
    Promise.resolve({ ok: true, value: { commandId: 'c1', result: { kind: 'success' as const } } }))
  const commandsRemote = { execute }
  const layout = { openDetails: vi.fn(), closeDetails: vi.fn(), toggleSidebar: vi.fn() }
  const connection = { api: { host: { openPath: vi.fn() } } }
  const sessions = {
    binding: vi.fn(),
    refreshSubagents: vi.fn(),
    openSubagent: vi.fn(),
    open: vi.fn(),
    list: { getSnapshot: () => ({ byId: {} }) },
  }
  ctx.provide('remote', {
    commands: commandsRemote,
    changes: { fileDiff: vi.fn() },
    canvas: { list: vi.fn(), get: vi.fn() },
  })
  ctx.provide('remote.commands', commandsRemote)
  ctx.provide('remote.changes', { fileDiff: vi.fn() })
  ctx.provide('remote.canvas', { list: vi.fn(), get: vi.fn() })
  ctx.provide('locale', new LocaleRuntime(ctx))
  ctx.provide('layout', layout)
  ctx.provide('connection', connection)
  ctx.provide('sessions', sessions)
  ctx.provide('workspaces', { connectWorkspace: vi.fn() })
  return { ctx, slots, execute, layout }
}

describe('ui-plan browser apply', () => {
  it('declares every service it binds', () => {
    expect(inject).toEqual([
      'slots', 'remote', 'remote.commands', 'remote.changes', 'remote.canvas', 'locale', 'layout',
      'connection', 'sessions', 'workspaces',
    ])
  })

  it('node-half apply is an intentional no-op', () => {
    expect(() => { nodeApply() }).not.toThrow()
  })

  it('waits until conversation declares the plan seat', async () => {
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    ctx.provide('remote', { commands: {}, changes: {}, canvas: {} })
    ctx.provide('remote.commands', {})
    ctx.provide('remote.changes', {})
    ctx.provide('remote.canvas', {})
    ctx.provide('locale', new LocaleRuntime(ctx))
    ctx.provide('layout', { openDetails: vi.fn(), closeDetails: vi.fn(), toggleSidebar: vi.fn() })
    ctx.provide('connection', { api: { host: { openPath: vi.fn() } } })
    ctx.provide('sessions', {
      binding: vi.fn(),
      refreshSubagents: vi.fn(),
      openSubagent: vi.fn(),
      open: vi.fn(),
      list: { getSnapshot: () => ({ byId: {} }) },
    })
    ctx.provide('workspaces', { connectWorkspace: vi.fn() })
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(ctx.slots.entries('conversation.input.plan')).toHaveLength(0)
    ctx.slots.register({
      name: 'root', children: {
        'conversation.input.plan': { kind: 'single', scope: 'session' },
        'conversation.session.header.utilities': { kind: 'list', scope: 'session' },
        'conversation.session.header.actions': { kind: 'list', scope: 'session' },
        'details': { kind: 'single', scope: 'session' },
      },
    } as never, () => null)
    await Promise.resolve()
    expect(ctx.slots.entries('conversation.input.plan')).toHaveLength(1)
  })

  it('registers the chip, executes /plan off, and unregisters on teardown', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const entry = b.slots.entries('conversation.input.plan')[0]!
    expect(entry.component).toBe(PlanChip)
    const injected = (entry.inject as unknown as (id: SessionId) => PlanChipInjected)(SID)

    await expect(injected.exitPlanMode()).resolves.toBeNull()
    expect(b.execute).toHaveBeenLastCalledWith(SID, '/plan off')

    // Business failure folds to the composer-visible line: the generated method
    // reports the RPC failure in its error branch.
    b.execute.mockResolvedValueOnce({
      ok: false,
      error: { code: 'session-not-found', message: 'gone', details: {} },
    } as never)
    await expect(injected.exitPlanMode()).resolves.toBe('gone (session-not-found)')

    // Unmatched admission (plan-mode not composed host-side) is also a failure line.
    b.execute.mockResolvedValueOnce({ ok: true, value: undefined } as never)
    await expect(injected.exitPlanMode()).resolves.toBe('unknown command: /plan off')

    await fiber.dispose()
    expect(b.slots.entries('conversation.input.plan')).toHaveLength(0)
  })

  it('wires overview open/close into the layout details column', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.slots.entries('details')).toHaveLength(1)
    const header = b.slots.entries('conversation.session.header.actions')
      .find(e => e.options.id === 'preview')
    expect(header).toBeDefined()
    const face = (header!.inject as () => { openPreview: () => void; closePreview: () => void })()
    face.openPreview()
    expect(b.layout.openDetails).toHaveBeenCalledTimes(1)
    face.closePreview()
    expect(b.layout.closeDetails).toHaveBeenCalledTimes(1)
    await fiber.dispose()
  })

  it('registers the presence dock on header utilities', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const dock = b.slots.entries('conversation.session.header.utilities')
      .find(e => e.options.id === 'presence')
    expect(dock).toBeDefined()
    await fiber.dispose()
    expect(b.slots.entries('conversation.session.header.utilities')).toHaveLength(0)
  })
})
