// @vitest-environment jsdom
/** ui-tool waits on conversationUiPrefs so ToolCallTree never gets an orphan store. */
import { describe, expect, it, vi } from 'vitest'
import { createSnapshotStore } from '@xrkseek/client-runtime/client'
import type { ClientContext } from '@xrkseek/client-runtime/client'
import { apply, inject } from '../src/client/apply.ts'

describe('ui-tool apply prefs wiring', () => {
  it('lists conversationUiPrefs in cordis inject (no apply-time orphan fallback)', () => {
    expect(inject).toContain('conversationUiPrefs')
  })

  it('binds ToolCallTree inject to the provided conversationUiPrefs store', () => {
    const live = createSnapshotStore(false)
    let registered: { inject: () => { hooks: { toolsDefaultExpanded: typeof live } } } | undefined

    const ctx = {
      get(name: string) {
        if (name === 'connection') {
          return { hostDescription: { getSnapshot: () => undefined, subscribe: () => () => {} } }
        }
        return undefined
      },
      conversationUiPrefs: { toolsDefaultExpanded: live },
      slots: {
        inject(_key: string, factory: () => unknown) {
          registered = factory() as typeof registered
        },
        register(options: { inject: () => { hooks: { toolsDefaultExpanded: typeof live } } }) {
          return options
        },
      },
      plugin: vi.fn(),
    } as unknown as ClientContext

    apply(ctx)
    expect(registered).toBeDefined()
    const bound = registered!.inject().hooks.toolsDefaultExpanded
    expect(bound).toBe(live)

    live.set(true)
    expect(bound.getSnapshot()).toBe(true)
  })
})
