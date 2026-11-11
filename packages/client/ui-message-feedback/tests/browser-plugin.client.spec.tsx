// @vitest-environment jsdom
/**
 * ui-message-feedback browser half: session dialog overlay, `/feedback`
 * decoration, and fiber dispose / reload. Per-message Like/Dislike actions
 * are no longer registered.
 */
import { Context, Service } from '@xrkseek/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { SlotRegistry, type SessionId } from '@xrkseek/client-runtime/client'
import { LocaleRuntime } from '@xrkseek/client-locale/client'
import type { MessageFeedbackItem, MessageFeedbackVersion } from '@xrkseek/xrk-message-feedback/types'
import type { MessageId } from '@xrkseek/client-connection/client'
import type { FeedbackDialogInjected } from '../src/client/slots.ts'
import { apply, inject } from '../src/client/index.ts'
import { apply as nodeApply } from '../src/index.ts'

afterEach(cleanup)

const sid = (k: string): SessionId => k as SessionId
const MSG = 'm-1' as MessageId

const seeded: MessageFeedbackItem = {
  messageId: MSG,
  rating: 'positive',
  version: 'v1' as MessageFeedbackVersion,
  createdAt: 1,
  updatedAt: 1,
}

/** Boot the plugin over fake faces. */
async function bench() {
  const ctx = new Context()
  const carried = <T,>(value: T) => Promise.resolve({ ok: true as const, value })
  const messageFeedback = {
    list: () => carried({ ok: true as const, value: { items: [seeded] } }),
    put: () => carried({ ok: true as const, value: seeded }),
    delete: () => carried({ ok: true as const, value: { absent: true as const } }),
  }
  class RemoteService extends Service {
    constructor(serviceCtx: Context) {
      super(serviceCtx, 'remote')
    }
  }
  new RemoteService(ctx)
  ctx.provide('remote.messageFeedback', messageFeedback)
  await ctx.plugin(SlotRegistry).await()
  ctx.slots.register({
    name: 'root',
    children: {
      'conversation.input.overlay': { kind: 'list', scope: 'session' },
      'conversation.chat.assistant-actions': { kind: 'list', scope: 'session' },
    },
  } as never, (() => null) as never)
  ctx.provide('locale', new LocaleRuntime(ctx))
  const decorate = vi.fn(() => () => {})
  ctx.provide('commandUi', { decorate })
  const fiber = ctx.plugin({ inject: [...inject, 'commandUi'], apply })
  return {
    ctx,
    fiber,
    decorate,
    dialogEntry: () => {
      const entry = ctx.slots.entries('conversation.input.overlay')
        .find(e => e.options.id === 'feedback-dialog')
      if (entry === undefined) return undefined
      return {
        ...entry.options,
        locale: entry.locale,
        inject: entry.inject as unknown as ((sessionId: SessionId) => FeedbackDialogInjected) | undefined,
      }
    },
  }
}

describe('ui-message-feedback browser plugin', () => {
  it('registers the session dialog overlay and does not mount per-message actions', async () => {
    const b = await bench()
    await b.fiber.await()

    expect(b.dialogEntry()).toMatchObject({ id: 'feedback-dialog', order: 2, locale: 'feedback' })
    expect(b.ctx.slots.entries('conversation.chat.assistant-actions')).toHaveLength(0)
  })

  it('decorates bare /feedback to open the session dialog', async () => {
    const b = await bench()
    await b.fiber.await()

    expect(b.decorate).toHaveBeenCalled()
    const spec = b.decorate.mock.calls[0]?.[0] as {
      name: string
      ui: { kind: string; run: (session: { sessionId: SessionId }) => void }
    }
    expect(spec.name).toBe('feedback')
    expect(spec.ui.kind).toBe('action')

    const face = b.dialogEntry()!.inject!(sid('s1'))
    expect(face.hooks.dialog.getSnapshot().target).toBeNull()
    spec.ui.run({ sessionId: sid('s1') })
    expect(face.hooks.dialog.getSnapshot().target).toEqual({ kind: 'session' })
  })

  it('shares one dialog controller across injects in the same Session', async () => {
    const b = await bench()
    await b.fiber.await()

    const first = b.dialogEntry()!.inject!(sid('s1'))
    const second = b.dialogEntry()!.inject!(sid('s1'))
    expect(first.hooks.dialog).toBe(second.hooks.dialog)
  })

  it('withdraws overlay registration with the plugin fiber', async () => {
    const b = await bench()
    await b.fiber.await()
    expect(b.dialogEntry()).toBeDefined()

    await b.fiber.dispose()

    expect(
      b.ctx.slots.entries('conversation.input.overlay').find(e => e.options.id === 'feedback-dialog'),
    ).toBeUndefined()
  })

  it('re-registers the dialog cleanly when the plugin is reloaded', async () => {
    const b = await bench()
    await b.fiber.await()
    await b.fiber.dispose()

    const reloaded = b.ctx.plugin({ inject: [...inject, 'commandUi'], apply })
    await reloaded.await()

    expect(b.dialogEntry()).toMatchObject({ id: 'feedback-dialog' })
  })

  it('the node half applies without host-side behavior', () => {
    expect(() => { nodeApply() }).not.toThrow()
  })
})
