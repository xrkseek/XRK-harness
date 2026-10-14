import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_PRESENCE_ENABLED,
  type PresenceSettings,
} from '../src/presence-settings.ts'
import { PresenceSettingsRuntime } from '../src/client/presence-settings-runtime.ts'
import type { SettingsScope, SettingsScopeSnapshot } from '@xrkseek/client-runtime/client'

function mockPresenceScope(
  initial?: Partial<PresenceSettings>,
): {
  scope: SettingsScope<PresenceSettings>
  set: ReturnType<typeof vi.fn>
  publish: (next: Partial<SettingsScopeSnapshot<PresenceSettings>>) => void
} {
  let snapshot: SettingsScopeSnapshot<PresenceSettings> = {
    status: 'ready',
    value: {
      enabled: DEFAULT_PRESENCE_ENABLED,
      shape: 'blob',
      color: 'cream',
      kit: 'none',
      kitHat: 'none',
      kitGlasses: 'none',
      kitHeld: 'none',
      overlayHat: '',
      overlayGlasses: '',
      overlayHeld: '',
      stickers: '[]',
      ...initial,
    },
    revision: 0,
    writable: true,
  }
  const listeners = new Set<() => void>()
  const set = vi.fn(async (field: string, value: unknown) => {
    snapshot = {
      ...snapshot,
      value: { ...snapshot.value!, [field]: value } as PresenceSettings,
      revision: snapshot.revision + 1,
    }
    for (const listener of listeners) listener()
  })
  return {
    set,
    publish: (next) => {
      snapshot = {
        ...snapshot,
        ...next,
        value: next.value
          ? ({ ...snapshot.value, ...next.value } as PresenceSettings)
          : snapshot.value,
        revision: next.revision ?? snapshot.revision + 1,
      }
      for (const listener of listeners) listener()
    },
    scope: {
      getSnapshot: () => snapshot,
      subscribe: (listener) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
      set,
      unset: vi.fn(async () => undefined),
    },
  }
}

describe('PresenceSettingsRuntime enabled', () => {
  it('defaults on and persists setEnabled(false)', () => {
    const host = mockPresenceScope()
    const runtime = new PresenceSettingsRuntime(host.scope)
    expect(runtime.getEnabled()).toBe(DEFAULT_PRESENCE_ENABLED)

    const changed = vi.fn()
    runtime.subscribe(changed)
    runtime.setEnabled(false)
    expect(runtime.getEnabled()).toBe(false)
    expect(host.set).toHaveBeenCalledWith('enabled', false)
    expect(changed).toHaveBeenCalledTimes(1)

    runtime.setEnabled(false)
    expect(changed).toHaveBeenCalledTimes(1)
  })

  it('adopts Host enabled without writing back', () => {
    const host = mockPresenceScope({ enabled: false })
    const runtime = new PresenceSettingsRuntime(host.scope)
    expect(runtime.getEnabled()).toBe(false)
    runtime.setEnabled(false)
    expect(host.set).not.toHaveBeenCalled()
  })
})
