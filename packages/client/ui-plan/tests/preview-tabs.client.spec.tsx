// @vitest-environment jsdom
/** Session Status tabs: Face session.status + live plan/todos + office RPC. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { makeTranslate } from '@xrkseek/client-test-runtime'
import { zh as commonZh } from '@xrkseek/client-locale/src/locales/zh.ts'
import { zh } from '../src/client/locales.ts'
import { PreviewOpenButton, PreviewTabs, type PreviewTabsProps } from '../src/client/PreviewTabs.tsx'
import { parseOfficePreview, parsePlanPreview, parseSessionStatus } from '../src/client/preview-load.ts'
import { resetOverviewSessionUiForTests } from '../src/client/overview-paint.ts'
import { resetOverviewLoadCacheForTests } from '../src/client/overview-load-cache.ts'

/** Matches ui-layout `LAYOUT_INSET_ATTR.details` (no cross-plugin value import). */
const DETAILS_INSET_ATTR = 'data-xrk-layout-details'

beforeEach(() => {
  resetOverviewSessionUiForTests()
  resetOverviewLoadCacheForTests()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  resetOverviewSessionUiForTests()
  resetOverviewLoadCacheForTests()
})

const t = makeTranslate(zh, commonZh)

/** Session-list stub — Overview re-pulls status when catalog/running flips. */
function useSessionsStub(): PreviewTabsProps['useSessions'] {
  return (select) => select({
    ids: [],
    byId: {},
    current: undefined,
    phase: 'ready',
    subagentsByParent: {},
    jobsBySession: {},
    currentAddress: undefined,
  } as never)
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

const sampleStatus = {
  sessionId: 's1',
  badge: '(default)',
  permission: 'default',
  plan: 'off' as const,
  theme: 'system',
  model: { provider: 'deepseek', model: 'deepseek-chat' },
  cwd: '/tmp',
  events: 3,
  jobs: [] as { id: string; status: string }[],
  subagents: {
    live: [] as {
      id: string
      activity: 'running' | 'inactive'
      mode: string
    }[],
    graph: { nodes: [] as { id: string; label: string }[], edges: [] as { from: string; to: string; kind: string }[] },
    quota: {
      depth: 0,
      maxDepth: 2,
      active: 0,
      maxActive: 2,
      delegated: 0,
      slotsFree: 2,
    },
  },
  teamTasks: [] as {
    id: string
    title: string
    status: string
    revision: number
  }[],
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    reasoning: 0,
    cost: 0,
    byModel: {},
    byProviderModel: {},
  },
  billing: {
    todayCost: 0,
    monthCost: 0,
    totalCost: 0,
    todayTokens: 0,
    monthTokens: 0,
    byModel: [],
    byProviderModel: [],
    dailyTrend: [
      { date: '2026-09-24', cost: 0.01, tokens: 100 },
      { date: '2026-09-25', cost: 0.02, tokens: 200 },
    ],
  },
  fleet: {
    health: 'ok' as const,
    runningJobs: 0,
    runningSubagents: 0,
    slotsFree: 2,
    queuedInbox: 0,
    channelAlerts: 0,
    alerts: [] as {
      id: string
      severity: 'info' | 'warn' | 'critical'
      message: string
    }[],
  },
  timeline: {
    total: 0,
    system: 0,
    tools: 0,
    user: 0,
    inject: 0,
    assistant: 0,
    tool: 0,
    requestCount: 0,
    eventCount: 0,
    injectSources: [] as string[],
    spillCount: 0,
    pruneCount: 0,
  },
  compaction: {
    pipeline: 'none' as const,
    stages: [] as ('prune' | 'summary')[],
    pruneCount: 0,
    summaryCount: 0,
    spillCount: 0,
    phase: 'idle' as const,
  },
  delivery: {
    turnActive: false,
    queued: 0,
    steering: 0,
    compactBlockedByTurn: false,
    queueAcceptedWhileBusy: true as const,
    steerRequiresActiveTurn: true as const,
    note: 'idle · queue accepts · compact available when agent idle',
  },
  channels: {
    process: [] as { pluginId: string; channelId: string }[],
    im: [{ channelId: 'telegram', displayName: 'Telegram', wired: 'bridge' }],
    note: '',
    alerts: [] as {
      id: string
      severity: 'info' | 'warn' | 'critical'
      message: string
    }[],
  },
}

/** A `useProjection` stand-in with flipable plan / todos / contextTimeline values. */
function fakeProjections(initial: {
  plan?: { active: boolean; pending: boolean }
  todos?: { content: string; status: string }[] | null
  contextTimeline?: {
    current: {
      system: number
      tools: number
      user: number
      inject: number
      assistant: number
      tool: number
      total: number
    }
    events: readonly {
      kind: string
      seq: number
      form?: string
      source?: string
      name?: string
      reason?: 'auto' | 'overflow' | 'manual'
      count?: number
      shadowedTokenCount?: number
      spill?: boolean
      spillPath?: string
      tool?: string
      prevTokens?: number
    }[]
    requests?: readonly unknown[]
  } | null
}) {
  const state = {
    plan: initial.plan,
    todos: initial.todos === undefined ? null : initial.todos,
    contextTimeline: initial.contextTimeline === undefined
      ? null
      : initial.contextTimeline,
  }
  const useProjection = vi.fn((key: string) => {
    if (key === 'plan') return state.plan
    if (key === 'todos') return state.todos
    if (key === 'contextTimeline') return state.contextTimeline
    return undefined
  })
  return { state, useProjection: useProjection as unknown as PreviewTabsProps['useProjection'] }
}

describe('preview envelopes', () => {
  it('reads plan.preview and office status shapes and rejects others', () => {
    expect(parsePlanPreview({ ok: true, value: { active: true, pending: false } })).toEqual({
      active: true,
      pending: false,
    })
    expect(parsePlanPreview({ ok: false })).toBeNull()
    expect(parseOfficePreview({
      result: { ok: true, value: { configured: true, connected: false } },
    })).toEqual({ configured: true, connected: false })
    expect(parseOfficePreview({ result: { ok: true, value: { state: 'idle' } } })).toBeNull()
  })

  it('parses Face session.status', () => {
    expect(parseSessionStatus({ result: { ok: true, value: sampleStatus } })).toEqual(sampleStatus)
  })
})

describe('PreviewTabs', () => {
  it('renders Status with harness self-node graph without update-depth thrash', async () => {
    const errors: unknown[] = []
    const onError = (event: ErrorEvent) => { errors.push(event.error ?? event.message) }
    window.addEventListener('error', onError)
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('session.status')) {
        return jsonResponse({
          result: {
            ok: true,
            value: {
              ...sampleStatus,
              badge: 'harness',
              subagents: {
                ...sampleStatus.subagents,
                graph: {
                  nodes: [{ id: 's1', label: 's1', role: 'observer', depth: 0 }],
                  edges: [],
                },
              },
              channels: {
                ...sampleStatus.channels,
                im: [
                  { channelId: 'telegram', displayName: 'Telegram', wired: 'discover' },
                  { channelId: 'discord', displayName: 'Discord', wired: 'discover' },
                ],
                alerts: [
                  { id: 'a1', severity: 'info', message: 'stub' },
                ],
              },
              compaction: {
                ...sampleStatus.compaction,
                pipeline: 'summary',
                stages: ['prune'],
                pruneCount: 1,
                summaryCount: 1,
                lastReason: 'auto',
                lastShadowedTokens: 100,
              },
              fleet: {
                ...sampleStatus.fleet,
                channelAlerts: 1,
                alerts: [{ id: 'a1', severity: 'info', message: 'stub' }],
              },
            },
          },
        })
      }
      return jsonResponse({ ok: false })
    }))
    const { useProjection } = fakeProjections({})
    render(
      <PreviewTabs
        {...({
          sessionId: 's1',
          closeDetails: vi.fn(),
          t,
          useProjection,
          useSessions: useSessionsStub(),
          openTeamChild: vi.fn(),
        } as PreviewTabsProps)}
      />,
    )
    await waitFor(() => {
      expect(screen.getByText('会话')).toBeTruthy()
    })
    expect(document.querySelector('[data-subagent-graph]')).toBeTruthy()
    window.removeEventListener('error', onError)
    const depth = errors.filter((e) => String(e).includes('Maximum update depth') || String(e).includes('#185'))
    expect(depth).toEqual([])
  })

  it('keeps the presence rail occupying space while session.status is still cold', async () => {
    // Overview open (frame without the collapsed stamp) + a status that never
    // lands. The rail must still render: gating it on `status !== null` made it
    // insert late and shove the whole body down by its own height.
    const frame = document.createElement('div')
    frame.setAttribute('data-dsh-frame', '')
    document.body.appendChild(frame)
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ok: false })))
    const { useProjection } = fakeProjections({})
    render(
      <PreviewTabs
        {...({
          sessionId: 's1',
          closeDetails: vi.fn(),
          t,
          useProjection,
          useSessions: useSessionsStub(),
          openTeamChild: vi.fn(),
        } as PreviewTabsProps)}
      />,
    )
    await waitFor(() => {
      expect(document.querySelector('[data-overview-presence-rail]')).toBeTruthy()
    })
    // Stage is sized by the CSS (aspect-ratio), so the placeholder holds its
    // full height; the wait shows as a spinner rather than an empty hole.
    const stage = document.querySelector('[data-overview-presence] .stage, [data-overview-presence-rail] button')
    expect(stage).toBeTruthy()
    expect(document.querySelector('[role="status"]')).toBeTruthy()
    document.querySelector('[data-dsh-frame]')?.remove()
  })

  it('keeps the presence-rail slot when Overview is collapsed (engine waits)', () => {
    const frame = document.createElement('div')
    frame.setAttribute('data-dsh-frame', '')
    frame.setAttribute('data-details-collapsed', '')
    document.body.appendChild(frame)
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ok: false })))
    const { useProjection } = fakeProjections({})
    render(
      <PreviewTabs
        {...({
          sessionId: 's1',
          closeDetails: vi.fn(),
          t,
          useProjection,
          useSessions: useSessionsStub(),
          openTeamChild: vi.fn(),
        } as PreviewTabsProps)}
      />,
    )
    const rail = document.querySelector('[data-overview-presence-rail]')
    expect(rail).toBeTruthy()
    expect(rail?.hasAttribute('aria-hidden')).toBe(true)
    expect(document.querySelector('[data-overview-presence]')).toBeTruthy()
    expect(document.querySelector('[role="status"]')).toBeTruthy()
    document.querySelector('[data-dsh-frame]')?.remove()
  })

  it('defaults to Status and shows standing todos after switching tabs', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('session.status')) {
        return jsonResponse({ result: { ok: true, value: sampleStatus } })
      }
      return jsonResponse({ ok: false })
    }))
    const { useProjection } = fakeProjections({
      todos: [
        { content: 'ship overview', status: 'in_progress' },
        { content: 'docs', status: 'pending' },
      ],
    })
    render(
      <PreviewTabs
        {...({
          sessionId: 's1',
          closeDetails: vi.fn(),
          t,
          useProjection,
          useSessions: useSessionsStub(),
        } as PreviewTabsProps)}
      />,
    )
    expect(screen.getByRole('tablist', { name: '会话概况' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: '概况' })).toBeTruthy()
    await waitFor(() => {
      expect(screen.getByText('会话')).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('tab', { name: '任务' }))
    expect(screen.getByText('ship overview')).toBeTruthy()
    expect(screen.getByText('docs')).toBeTruthy()
    expect(screen.getByText('进行中')).toBeTruthy()
  })

  it('folds plan · Office flags into the Status session card', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('plan.preview')) {
        return jsonResponse({ ok: true, value: { active: true, pending: false } })
      }
      if (url.includes('session.status')) {
        return jsonResponse({ result: { ok: true, value: sampleStatus } })
      }
      return jsonResponse({
        result: { ok: true, value: { configured: false, connected: false } },
      })
    })
    vi.stubGlobal('fetch', fetchImpl)
    const closeDetails = vi.fn()
    render(
      <PreviewTabs
        {...({
          sessionId: 's1',
          closeDetails,
          t,
          useProjection: fakeProjections({}).useProjection,
          useSessions: useSessionsStub(),
        } as PreviewTabsProps)}
      />,
    )
    await waitFor(() => {
      expect(screen.getByLabelText('会话')).toBeTruthy()
    })
    // Expand the session card (starts collapsed).
    fireEvent.click(within(screen.getByLabelText('会话')).getByRole('button'))
    await waitFor(() => {
      expect(screen.getByText('计划模式')).toBeTruthy()
    })
    expect(screen.getByText('是')).toBeTruthy()
    expect(screen.getByText('已配置')).toBeTruthy()
    expect(screen.getAllByText('否').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('tab', { name: '任务' }))
    expect(screen.getByText(/尚无站立计划/)).toBeTruthy()
    expect(screen.queryByRole('tab', { name: '计划' })).toBeNull()
    expect(screen.queryByRole('tab', { name: 'Office' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '关闭概况栏' }))
    expect(closeDetails).toHaveBeenCalledTimes(1)
  })

  it('rides the live plan projection on the Status session card', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('session.status')) {
        return jsonResponse({ result: { ok: true, value: sampleStatus } })
      }
      return jsonResponse({ ok: false })
    }))
    const { state, useProjection } = fakeProjections({ plan: { active: false, pending: false } })
    const props = {
      sessionId: 's1', closeDetails: vi.fn(), t, useProjection, useSessions: useSessionsStub(),
    } as PreviewTabsProps
    const view = render(<PreviewTabs {...props} />)
    await waitFor(() => {
      expect(screen.getByLabelText('会话')).toBeTruthy()
    })
    fireEvent.click(within(screen.getByLabelText('会话')).getByRole('button'))
    await waitFor(() => {
      expect(screen.getByText('计划模式')).toBeTruthy()
    })
    expect(screen.getAllByText('否').length).toBeGreaterThan(0)
    state.plan = { active: true, pending: false }
    view.rerender(<PreviewTabs {...props} />)
    expect(screen.getByText('是')).toBeTruthy()
  })

  it('Status uses Face timeline summary; Context tab binds live contextTimeline events', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('session.status')) {
        return jsonResponse({
          result: {
            ok: true,
            value: {
              ...sampleStatus,
              timeline: {
                ...sampleStatus.timeline,
                total: 95,
                system: 10,
                tools: 5,
                user: 20,
                inject: 8,
                assistant: 40,
                tool: 12,
                requestCount: 1,
                eventCount: 3,
                injectSources: ['skill-catalog:catalog'],
                lastCompactReason: 'overflow',
                lastShadowedTokens: 1200,
                spillCount: 1,
                pruneCount: 1,
              },
            },
          },
        })
      }
      return jsonResponse({ ok: false })
    }))
    const { useProjection } = fakeProjections({
      contextTimeline: {
        current: {
          system: 10,
          tools: 5,
          user: 20,
          inject: 8,
          assistant: 40,
          tool: 12,
          total: 95,
        },
        requests: [{}],
        events: [
          {
            kind: 'inject',
            seq: 2,
            source: 'skill-catalog',
            form: 'catalog',
            name: 'catalog',
          },
          {
            kind: 'compaction',
            seq: 9,
            reason: 'overflow',
            count: 4,
            shadowedTokenCount: 1200,
          },
          {
            kind: 'prune',
            seq: 11,
            tool: 'bash',
            spill: true,
            spillPath: '/tmp/spill/tool-outputs/s_tc1.txt',
            prevTokens: 900,
          },
        ],
      },
    })
    render(
      <PreviewTabs
        {...({
          sessionId: 's1',
          closeDetails: vi.fn(),
          t,
          useProjection,
          useSessions: useSessionsStub(),
        } as PreviewTabsProps)}
      />,
    )
    await waitFor(() => {
      expect(screen.getAllByText('95').length).toBeGreaterThan(0)
    })
    // Status keeps the slim summary (counts + inject sources), not event rows.
    expect(screen.getAllByText(/skill-catalog:catalog/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/overflow/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/被遮蔽 tokens 1,?200/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/修剪 1/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/落盘 1/).length).toBeGreaterThan(0)
    expect(screen.queryByText('prune · spill')).toBeNull()
    expect(screen.queryByText('compact · overflow')).toBeNull()
    expect(screen.getByText(/完整事件与 spill 预览见/)).toBeTruthy()
    // Idle compaction / delivery cards stay hidden — only surface when busy.
    expect(screen.queryByLabelText('压缩分阶')).toBeNull()
    expect(screen.queryByLabelText('队列 / 回合')).toBeNull()

    fireEvent.click(screen.getByRole('tab', { name: '上下文' }))
    await waitFor(() => {
      expect(screen.getByText('prune · spill')).toBeTruthy()
    })
    expect(screen.getByText('compact · overflow')).toBeTruthy()
  })

  it('opens spill paths from Context event rows via openSpillPath', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('session.status')) {
        return jsonResponse({ result: { ok: true, value: sampleStatus } })
      }
      return jsonResponse({ ok: false })
    }))
    const openSpillPath = vi.fn()
    const { useProjection } = fakeProjections({
      contextTimeline: {
        current: {
          system: 1, tools: 1, user: 1, inject: 0, assistant: 1, tool: 1, total: 5,
        },
        requests: [],
        events: [
          {
            kind: 'prune',
            seq: 3,
            tool: 'bash',
            spill: true,
            spillPath: '/home/u/.xrk/spill/tool-outputs/s_c.txt',
          },
        ],
      },
    })
    render(
      <PreviewTabs
        {...({
          sessionId: 's1',
          closeDetails: vi.fn(),
          openSpillPath,
          t,
          useProjection,
          useSessions: useSessionsStub(),
        } as PreviewTabsProps)}
      />,
    )
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: '上下文' })).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('tab', { name: '上下文' }))
    await waitFor(() => {
      expect(screen.getByText('prune · spill')).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: '查看落盘文件' }))
    expect(openSpillPath).toHaveBeenCalledWith(
      '/home/u/.xrk/spill/tool-outputs/s_c.txt',
    )
  })

  it('exposes a Changes tab that stays empty until workspaceChanges arrive', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('session.status')) {
        return jsonResponse({ result: { ok: true, value: sampleStatus } })
      }
      return jsonResponse({ ok: false })
    }))
    render(
      <PreviewTabs
        {...({
          sessionId: 's1',
          closeDetails: vi.fn(),
          loadFileDiff: vi.fn(async () => null),
          openChangedFile: vi.fn(),
          t,
          useProjection: fakeProjections({}).useProjection,
          useSessions: useSessionsStub(),
        } as PreviewTabsProps)}
      />,
    )
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: '改动' })).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('tab', { name: '改动' }))
    expect(screen.getByText(/本会话尚无改动摘要/)).toBeTruthy()
  })

  it('re-pulls session.status when jobsBySession status flips', async () => {
    let jobs: { id: string; status: string; kind: string; label: string; startedAt: number }[] = [
      { id: 'job-1', status: 'running', kind: 'bash', label: 'sleep', startedAt: 1 },
    ]
    const useSessionsLive: PreviewTabsProps['useSessions'] = (select) => select({
      ids: [],
      byId: {},
      current: undefined,
      phase: 'ready',
      subagentsByParent: {},
      jobsBySession: { s1: jobs },
      currentAddress: undefined,
    } as never)

    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('session.status')) {
        return jsonResponse({ result: { ok: true, value: sampleStatus } })
      }
      return jsonResponse({ ok: false })
    })
    vi.stubGlobal('fetch', fetchImpl)

    const { rerender } = render(
      <PreviewTabs
        {...({
          sessionId: 's1',
          closeDetails: vi.fn(),
          t,
          useProjection: fakeProjections({}).useProjection,
          useSessions: useSessionsLive,
        } as PreviewTabsProps)}
      />,
    )
    await waitFor(() => {
      expect(fetchImpl.mock.calls.some((c) => String(c[0]).includes('session.status'))).toBe(true)
    })
    const before = fetchImpl.mock.calls.filter((c) => String(c[0]).includes('session.status')).length

    jobs = [{ id: 'job-1', status: 'completed', kind: 'bash', label: 'sleep', startedAt: 1 }]
    rerender(
      <PreviewTabs
        {...({
          sessionId: 's1',
          closeDetails: vi.fn(),
          t,
          useProjection: fakeProjections({}).useProjection,
          useSessions: useSessionsLive,
        } as PreviewTabsProps)}
      />,
    )
    await waitFor(() => {
      expect(
        fetchImpl.mock.calls.filter((c) => String(c[0]).includes('session.status')).length,
      ).toBeGreaterThan(before)
    })
  })

  it('re-pulls session.status when a byId child flips running via parentId', async () => {
    let byId: Record<string, {
      id: string
      displayTitle: string
      running: boolean
      blank: boolean
      updatedAt: number
      origin?: 'subagent'
      parentId?: string
    }> = {
      s1: {
        id: 's1', displayTitle: 's1', running: false, blank: false, updatedAt: 1,
      },
      child: {
        id: 'child',
        displayTitle: 'child',
        running: false,
        blank: false,
        updatedAt: 1,
        origin: 'subagent',
        parentId: 's1',
      },
    }
    const useSessionsLive: PreviewTabsProps['useSessions'] = (select) => select({
      ids: ['s1'],
      byId,
      current: 's1',
      phase: 'ready',
      subagentsByParent: {},
      jobsBySession: {},
      currentAddress: undefined,
    } as never)

    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('session.status')) {
        return jsonResponse({ result: { ok: true, value: sampleStatus } })
      }
      return jsonResponse({ ok: false })
    })
    vi.stubGlobal('fetch', fetchImpl)

    const { rerender } = render(
      <PreviewTabs
        {...({
          sessionId: 's1',
          closeDetails: vi.fn(),
          t,
          useProjection: fakeProjections({}).useProjection,
          useSessions: useSessionsLive,
        } as PreviewTabsProps)}
      />,
    )
    await waitFor(() => {
      expect(fetchImpl.mock.calls.some((c) => String(c[0]).includes('session.status'))).toBe(true)
    })
    const before = fetchImpl.mock.calls.filter((c) => String(c[0]).includes('session.status')).length

    byId = {
      ...byId,
      child: { ...byId.child!, running: true },
    }
    rerender(
      <PreviewTabs
        {...({
          sessionId: 's1',
          closeDetails: vi.fn(),
          t,
          useProjection: fakeProjections({}).useProjection,
          useSessions: useSessionsLive,
        } as PreviewTabsProps)}
      />,
    )
    await waitFor(() => {
      expect(
        fetchImpl.mock.calls.filter((c) => String(c[0]).includes('session.status')).length,
      ).toBeGreaterThan(before)
    })
  })

  it('expands a Status job row to peek output and two-press kills', async () => {
    const statusWithJob = {
      ...sampleStatus,
      jobs: [{ id: 'job-1', status: 'running', label: 'sleep 5' }],
    }
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('session.status')) {
        return jsonResponse({ result: { ok: true, value: statusWithJob } })
      }
      return jsonResponse({ ok: false })
    }))
    const peekJobOutput = vi.fn(async () => ({ text: 'partial\n', truncated: false }))
    const killJob = vi.fn()
    render(
      <PreviewTabs
        {...({
          sessionId: 's1',
          closeDetails: vi.fn(),
          peekJobOutput,
          killJob,
          t,
          useProjection: fakeProjections({}).useProjection,
          useSessions: useSessionsStub(),
        } as PreviewTabsProps)}
      />,
    )
    await waitFor(() => {
      expect(screen.getByText('sleep 5')).toBeTruthy()
    })
    // Jobs card starts collapsed; expand it so the peek control is reachable.
    fireEvent.click(screen.getByRole('button', { name: /后台任务/ }))
    fireEvent.click(screen.getByRole('button', { name: '展开 sleep 5 的输出' }))
    await waitFor(() => {
      expect(peekJobOutput).toHaveBeenCalledWith('job-1')
    })
    expect(await screen.findByText('partial')).toBeTruthy()
    const stop = screen.getByRole('button', { name: '停止 sleep 5' })
    fireEvent.click(stop)
    expect(killJob).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '确认停止' }))
    expect(killJob).toHaveBeenCalledWith('job-1')
  })

  it('exposes cold resume and merge actions on Teams task rows', async () => {
    const statusWithTask = {
      ...sampleStatus,
      badge: 'harness',
      teamTasks: [
        {
          id: 't1',
          title: 'ship feature',
          status: 'paused',
          revision: 1,
          childSessionId: 'child-1',
          worktreeId: 'lease-9',
          worktreeLeaseStatus: 'retained',
          externalResume: 'cold' as const,
        },
      ],
    }
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('session.status')) {
        return jsonResponse({ result: { ok: true, value: statusWithTask } })
      }
      return jsonResponse({ ok: false })
    }))
    const resumeTeamChild = vi.fn(async () => undefined)
    const mergeTeamWorktree = vi.fn(async () => undefined)
    const { useProjection } = fakeProjections({})
    render(
      <PreviewTabs
        {...({
          sessionId: 's1',
          closeDetails: vi.fn(),
          resumeTeamChild,
          mergeTeamWorktree,
          t,
          useProjection,
          useSessions: useSessionsStub(),
        } as PreviewTabsProps)}
      />,
    )
    await waitFor(() => {
      expect(screen.getByText('ship feature')).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: '冷恢复' }))
    expect(resumeTeamChild).toHaveBeenCalledWith({
      parentSessionId: 's1',
      childSessionId: 'child-1',
    })
    fireEvent.click(screen.getByRole('button', { name: '合回主仓' }))
    expect(mergeTeamWorktree).toHaveBeenCalledWith({
      leaseId: 'lease-9',
      pruneAfter: true,
    })
  })
})

describe('PreviewOpenButton', () => {
  it('opens the details column and says what it opens', () => {
    const openPreview = vi.fn()
    const closePreview = vi.fn()
    document.documentElement.removeAttribute(DETAILS_INSET_ATTR)
    render(<PreviewOpenButton openPreview={openPreview} closePreview={closePreview} t={t} />)
    const button = screen.getByRole('button', { name: '概况' })
    expect(button.getAttribute('title')).toContain('/status')
    expect(button.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(button)
    expect(openPreview).toHaveBeenCalledTimes(1)
    expect(closePreview).not.toHaveBeenCalled()
  })

  it('closes the details column when it is already open', () => {
    document.documentElement.setAttribute(DETAILS_INSET_ATTR, '')
    const openPreview = vi.fn()
    const closePreview = vi.fn()
    render(<PreviewOpenButton openPreview={openPreview} closePreview={closePreview} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: '关闭概况栏' }))
    expect(closePreview).toHaveBeenCalledTimes(1)
    expect(openPreview).not.toHaveBeenCalled()
    document.documentElement.removeAttribute(DETAILS_INSET_ATTR)
  })
})
