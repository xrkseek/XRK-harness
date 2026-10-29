/**
 * PresenceDock: compact ball on the main header while Overview is closed.
 */
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@xrkseek/client-runtime/client'
import {
  PRESENCE_DOCK_EXIT_MS,
  PresenceDock,
} from '../src/client/PresenceDock.tsx'
import { bindPresenceSettingsRuntime } from '../src/client/PresenceBall.tsx'
import { PresenceSettingsRuntime } from '../src/client/presence-settings-runtime.ts'
import { zh } from '../src/client/locales.ts'
import {
  DEFAULT_PRESENCE_ENABLED,
  type PresenceSettings,
} from '../src/presence-settings.ts'
import type { SettingsScope, SettingsScopeSnapshot } from '@xrkseek/client-runtime/client'

function presenceScope(
  initial?: Partial<PresenceSettings>,
): SettingsScope<PresenceSettings> {
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
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set: async (field, value) => {
      snapshot = {
        ...snapshot,
        value: { ...snapshot.value!, [field]: value } as PresenceSettings,
        revision: (snapshot.revision ?? 0) + 1,
      }
      for (const listener of listeners) listener()
    },
    unset: async () => undefined,
    patch: async (ops) => {
      let value = { ...snapshot.value! } as PresenceSettings
      for (const op of ops) {
        const field = op.path[0]
        if (typeof field !== 'string') continue
        if (op.op === 'set') (value as Record<string, unknown>)[field] = op.value
        else delete (value as Record<string, unknown>)[field]
      }
      snapshot = {
        ...snapshot,
        value,
        revision: (snapshot.revision ?? 0) + 1,
      }
      for (const listener of listeners) listener()
    },
  }
}

const SID = 's-dock' as SessionId
const EMPTY_CUES = { activityAt: 0 } as const

function t(key: string): string {
  return (zh as Record<string, string>)[key] ?? key
}

function useSessions(select: (s: {
  byId: Record<string, { id: SessionId; running: boolean; parentId?: SessionId; origin: string }>
  subagentsByParent: Record<string, unknown>
  jobsBySession: Record<string, unknown[]>
}) => unknown): unknown {
  return select({
    byId: { [SID]: { id: SID, running: false, origin: 'user' } },
    subagentsByParent: {},
    jobsBySession: {},
  })
}

function renderDock() {
  return render(
    <PresenceDock
      sessionId={SID}
      presenceCues={{
        getSnapshot: () => EMPTY_CUES,
        subscribe: () => () => {},
      }}
      useSessions={useSessions as never}
      t={t as never}
    />,
  )
}

describe('PresenceDock', () => {
  afterEach(() => {
    cleanup()
    document.documentElement.removeAttribute('data-xrk-layout-details')
    document.documentElement.removeAttribute('data-xrk-layout-phone')
    document.querySelector('[data-dsh-frame]')?.remove()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    // Reset to default-on so other specs see an enabled ball.
    bindPresenceSettingsRuntime(new PresenceSettingsRuntime(presenceScope()))
  })

  beforeEach(() => {
    bindPresenceSettingsRuntime(new PresenceSettingsRuntime(presenceScope()))
    vi.stubGlobal('fetch', vi.fn(async () => ({
      json: async () => ({
        result: {
          ok: true,
          value: {
            sessionId: SID,
            badge: 'harness',
            permission: 'default',
            plan: 'off',
            theme: 'dark',
            model: { provider: 'p', model: 'm' },
            cwd: '/',
            events: 0,
            jobs: [],
            subagents: {
              live: [],
              graph: { nodes: [], edges: [] },
              quota: {
                depth: 0, maxDepth: 3, active: 0, maxActive: 4, delegated: 0, slotsFree: 4,
              },
            },
            teamTasks: [],
            fleet: { health: 'ok', alerts: [] },
            billing: { todayCost: 0, monthCost: 0, byProviderModel: [] },
            timeline: { windowTokens: 0, shadowedTokens: 0, entries: [] },
            compaction: { pipeline: 'idle', stages: [], phase: 'idle' },
            delivery: {
              turnActive: false, queued: 0, steering: 0,
              compactBlockedByTurn: false, note: '',
            },
            channels: { process: [], im: [], note: '', alerts: [] },
          },
        },
      }),
    })))
  })

  it('shows a header-density compact ball when Overview is closed', async () => {
    const frame = document.createElement('div')
    frame.setAttribute('data-dsh-frame', '')
    frame.setAttribute('data-details-collapsed', '')
    document.body.appendChild(frame)

    renderDock()

    await waitFor(() => {
      const ball = document.querySelector('[data-overview-presence][data-compact]')
      expect(document.querySelector('[data-presence-dock]')).toBeTruthy()
      expect(ball).toBeTruthy()
      expect(ball?.getAttribute('data-density')).toBe('header')
    })
  })

  it('portals an icon ball into the phone chrome seat', async () => {
    document.documentElement.setAttribute('data-xrk-layout-phone', '')
    const frame = document.createElement('div')
    frame.setAttribute('data-dsh-frame', '')
    frame.setAttribute('data-details-collapsed', '')
    const slot = document.createElement('span')
    slot.setAttribute('data-phone-presence-slot', '')
    frame.appendChild(slot)
    document.body.appendChild(frame)

    renderDock()

    await waitFor(() => {
      const dock = slot.querySelector('[data-presence-dock]')
      expect(dock).toBeTruthy()
      expect(dock?.hasAttribute('data-phone-dock')).toBe(true)
      expect(slot.querySelector('[data-overview-presence][data-compact]')).toBeTruthy()
    })

    document.documentElement.removeAttribute('data-xrk-layout-phone')
  })

  it('uses companionBall (or agent fallback), never Settings boss look alone', async () => {
    const frame = document.createElement('div')
    frame.setAttribute('data-dsh-frame', '')
    frame.setAttribute('data-details-collapsed', '')
    document.body.appendChild(frame)

    renderDock()

    await waitFor(() => {
      expect(document.querySelector('[data-overview-presence]')).toBeTruthy()
    })
    // Fallback memberLook is always passed — PresenceBall must not paint with
    // only Settings ui-presence (老板). Companion shape arrives via status poll.
    expect(document.querySelector('[data-presence-dock]')).toBeTruthy()
  })

  it('unmounts entirely when presence is disabled', () => {
    const runtime = new PresenceSettingsRuntime(presenceScope({ enabled: false }))
    bindPresenceSettingsRuntime(runtime)

    const frame = document.createElement('div')
    frame.setAttribute('data-dsh-frame', '')
    frame.setAttribute('data-details-collapsed', '')
    document.body.appendChild(frame)

    renderDock()
    expect(document.querySelector('[data-presence-dock]')).toBeNull()
    expect(document.querySelector('[data-overview-presence]')).toBeNull()
  })

  it('keeps a zero-width seat (no ball) when Overview is already open', async () => {
    const frame = document.createElement('div')
    frame.setAttribute('data-dsh-frame', '')
    document.body.appendChild(frame)

    renderDock()

    await waitFor(() => {
      const seat = document.querySelector('[data-presence-dock]')
      expect(seat).toBeTruthy()
      expect(seat?.getAttribute('data-phase')).toBe('gone')
      expect(document.querySelector('[data-overview-presence]')).toBeNull()
    })
  })

  it('exits then collapses to a gone seat when Overview opens', async () => {
    vi.useFakeTimers()
    const frame = document.createElement('div')
    frame.setAttribute('data-dsh-frame', '')
    frame.setAttribute('data-details-collapsed', '')
    document.body.appendChild(frame)

    renderDock()
    expect(document.querySelector('[data-overview-presence]')).toBeTruthy()

    act(() => {
      frame.removeAttribute('data-details-collapsed')
    })

    await act(async () => {
      await Promise.resolve()
    })

    const exiting = document.querySelector('[data-presence-dock]')
    expect(exiting).toBeTruthy()
    expect(exiting?.getAttribute('data-phase')).toBe('exit')

    act(() => {
      vi.advanceTimersByTime(PRESENCE_DOCK_EXIT_MS + 1)
    })

    const seat = document.querySelector('[data-presence-dock]')
    expect(seat).toBeTruthy()
    expect(seat?.getAttribute('data-phase')).toBe('gone')
    expect(document.querySelector('[data-overview-presence]')).toBeNull()
  })
})
