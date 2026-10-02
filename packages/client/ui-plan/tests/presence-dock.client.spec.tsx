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
import { zh } from '../src/client/locales.ts'

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
    document.querySelector('[data-dsh-frame]')?.remove()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  beforeEach(() => {
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
