// @vitest-environment jsdom
/** ui-tool must not capture an orphan toolsDefaultExpanded store at apply time. */
import { describe, expect, it, vi } from 'vitest'
import { createSnapshotStore } from '@xrkseek/client-runtime/client'
import type { ClientContext } from '@xrkseek/client-runtime/client'
import { apply } from '../src/client/apply.ts'

describe('ui-tool apply prefs race', () => {
  it('binds ToolCallTree inject to conversationUiPrefs resolved when the chat.node slot appears', () => {
    const live = createSnapshotStore(false)
    let prefsReady = false
    let slotFactory: (() => { inject: () => { hooks: { toolsDefaultExpanded: typeof live } } }) | undefined

    const ctx = {
      get(name: string) {
        if (name === 'connection') {
          return { hostDescription: { getSnapshot: () => undefined, subscribe: () => () => {} } }
        }
        if (name === 'conversationUiPrefs') {
          return prefsReady ? { toolsDefaultExpanded: live } : undefined
        }
        return undefined
      },
      slots: {
        inject(_key: string, factory: () => unknown) {
          slotFactory = factory as typeof slotFactory
        },
        register(options: { inject: () => { hooks: { toolsDefaultExpanded: typeof live } } }) {
          return options
        },
      },
      plugin: vi.fn(),
    } as unknown as ClientContext

    // Fiber apply races ahead of ui-conversation.provide — prefs absent.
    apply(ctx)
    expect(slotFactory).toBeTypeOf('function')

    // conversation.chat.node declaration fires the deferred factory after provide.
    prefsReady = true
    const registered = slotFactory!()
    const bound = registered.inject().hooks.toolsDefaultExpanded
    expect(bound).toBe(live)

    live.set(true)
    expect(bound.getSnapshot()).toBe(true)
  })
})
