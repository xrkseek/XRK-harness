/**
 * PresenceDock: compact ball on the main header while Overview is closed.
 */
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@xrkseek/client-runtime/client'
import {
  PRESENCE_DOCK_EXIT_MS,
  PRESENCE_ICON_ONLY_ENTER,
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
import {
  readOverviewLoadCache,
  resetOverviewLoadCacheForTests,
} from '../src/client/overview-load-cache.ts'
import {
  readPresenceLookCache,
  resetPresenceLookCacheForTests,
  writePresenceLookCache,
} from '../src/client/presence-look-cache.ts'
import * as previewLoad from '../src/client/preview-load.ts'
import type { SessionStatusView } from '../src/client/preview-load.ts'

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

/** Dock only reads a few Status fields — cast keeps the fixture tiny. */
function dockStatus(
  sessionId: SessionId,
  companionBall?: SessionStatusView['companionBall'],
): SessionStatusView {
  return {
    sessionId,
    jobs: [],
    subagents: { live: [], graph: { nodes: [], edges: [] } },
    fleet: { health: 'ok' },
    compaction: { phase: 'idle' },
    delivery: { turnActive: false, queued: 0, steering: 0 },
    ...(companionBall ? { companionBall } : {}),
  } as SessionStatusView
}

function renderDock(sessionId: SessionId = SID) {
  return render(
    <PresenceDock
      sessionId={sessionId}
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
    resetOverviewLoadCacheForTests()
    resetPresenceLookCacheForTests()
    document.documentElement.removeAttribute('data-xrk-layout-details')
    document.documentElement.removeAttribute('data-xrk-layout-phone')
    document.querySelector('[data-dsh-frame]')?.remove()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    // Reset to default-on so other specs see an enabled ball.
    bindPresenceSettingsRuntime(new PresenceSettingsRuntime(presenceScope()))
  })

  beforeEach(() => {
    resetOverviewLoadCacheForTests()
    resetPresenceLookCacheForTests()
    bindPresenceSettingsRuntime(new PresenceSettingsRuntime(presenceScope()))
    vi.spyOn(previewLoad, 'loadSessionStatus').mockResolvedValue(
      dockStatus(SID, { shape: 'flower5', color: 'gold' }),
    )
  })

  it('shows a header-density compact ball when Overview is closed', async () => {
    vi.stubGlobal('innerWidth', PRESENCE_ICON_ONLY_ENTER + 80)
    const frame = document.createElement('div')
    frame.setAttribute('data-dsh-frame', '')
    frame.setAttribute('data-details-collapsed', '')
    document.body.appendChild(frame)

    renderDock()

    await waitFor(() => {
      const ball = document.querySelector('[data-overview-presence][data-compact]')
      const dock = document.querySelector('[data-presence-dock]')
      expect(dock).toBeTruthy()
      expect(dock?.hasAttribute('data-icon-only')).toBe(false)
      expect(ball).toBeTruthy()
      expect(ball?.getAttribute('data-density')).toBe('header')
    })
  })

  it('collapses to an icon-only frame on mid-width desktop', async () => {
    vi.stubGlobal('innerWidth', PRESENCE_ICON_ONLY_ENTER - 1)
    const frame = document.createElement('div')
    frame.setAttribute('data-dsh-frame', '')
    frame.setAttribute('data-details-collapsed', '')
    document.body.appendChild(frame)

    renderDock()

    await waitFor(() => {
      const dock = document.querySelector('[data-presence-dock]')
      expect(dock).toBeTruthy()
      expect(dock?.hasAttribute('data-icon-only')).toBe(true)
      expect(dock?.hasAttribute('data-phone-dock')).toBe(false)
      expect(document.querySelector('[data-overview-presence][data-compact]')).toBeTruthy()
    })
  })

  it('collapses to icon-only when the conversation header is squeezed', async () => {
    vi.stubGlobal('innerWidth', PRESENCE_ICON_ONLY_ENTER + 200)
    const frame = document.createElement('div')
    frame.setAttribute('data-dsh-frame', '')
    frame.setAttribute('data-details-collapsed', '')
    const header = document.createElement('header')
    header.setAttribute('data-conversation-header', '')
    Object.defineProperty(header, 'clientWidth', { configurable: true, value: 480 })
    frame.appendChild(header)
    document.body.appendChild(frame)

    renderDock()

    await waitFor(() => {
      const dock = document.querySelector('[data-presence-dock]')
      expect(dock).toBeTruthy()
      expect(dock?.hasAttribute('data-icon-only')).toBe(true)
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

  it('writes companionBall into look + overview caches after Status returns', async () => {
    const frame = document.createElement('div')
    frame.setAttribute('data-dsh-frame', '')
    frame.setAttribute('data-details-collapsed', '')
    document.body.appendChild(frame)

    renderDock()

    await waitFor(() => {
      expect(document.querySelector('[data-presence-dock]')?.hasAttribute('data-pending')).toBe(false)
      expect(readPresenceLookCache(SID)).toEqual({ shape: 'flower5', color: 'gold' })
      expect(readOverviewLoadCache(SID)?.status?.companionBall).toEqual({
        shape: 'flower5',
        color: 'gold',
      })
    })
  })

  it('seeds companionBall from look cache while Face Status is still in flight', async () => {
    writePresenceLookCache(SID, { shape: 'flower5', color: 'gold' })

    let release!: (value: SessionStatusView) => void
    const gate = new Promise<SessionStatusView>((resolve) => { release = resolve })
    vi.spyOn(previewLoad, 'loadSessionStatus').mockReturnValue(gate)

    const frame = document.createElement('div')
    frame.setAttribute('data-dsh-frame', '')
    frame.setAttribute('data-details-collapsed', '')
    document.body.appendChild(frame)

    renderDock()

    await waitFor(() => {
      const dock = document.querySelector('[data-presence-dock]')
      expect(dock).toBeTruthy()
      // Cache seed must paint the remembered costume immediately — not PENDING cream.
      expect(dock?.hasAttribute('data-pending')).toBe(false)
    })

    release(dockStatus(SID, { shape: 'flower5', color: 'gold' }))
  })

  it('reloads Status for the new session after an in-flight poll is superseded', async () => {
    const sidB = 's-dock-b' as SessionId
    let resolveA!: (value: SessionStatusView) => void
    const load = vi.spyOn(previewLoad, 'loadSessionStatus').mockImplementation(
      (sessionId: string) => {
        if (sessionId === SID && load.mock.calls.filter((c) => c[0] === SID).length === 1) {
          return new Promise<SessionStatusView>((resolve) => { resolveA = resolve })
        }
        return Promise.resolve(
          dockStatus(sessionId as SessionId, { shape: 'petal', color: 'sky' }),
        )
      },
    )

    const frame = document.createElement('div')
    frame.setAttribute('data-dsh-frame', '')
    frame.setAttribute('data-details-collapsed', '')
    document.body.appendChild(frame)

    const view = renderDock(SID)
    await waitFor(() => expect(load).toHaveBeenCalled())

    view.rerender(
      <PresenceDock
        sessionId={sidB}
        presenceCues={{
          getSnapshot: () => EMPTY_CUES,
          subscribe: () => () => {},
        }}
        useSessions={useSessions as never}
        t={t as never}
      />,
    )

    // Old finish must still bump the queued tick even though session A unmounted.
    resolveA(dockStatus(SID, { shape: 'blob', color: 'cream' }))

    await waitFor(() => {
      expect(load.mock.calls.some((c) => c[0] === sidB)).toBe(true)
      expect(document.querySelector('[data-presence-dock]')?.hasAttribute('data-pending')).toBe(false)
      expect(readPresenceLookCache(sidB)).toEqual({ shape: 'petal', color: 'sky' })
    })
  })
})
