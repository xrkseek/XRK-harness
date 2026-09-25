// @vitest-environment jsdom
/** Session Status tabs: Face session.status + live plan/todos + office RPC. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@xrkseek/client-test-runtime'
import { zh as commonZh } from '@xrkseek/client-locale/src/locales/zh.ts'
import { zh } from '../src/client/locales.ts'
import { PreviewOpenButton, PreviewTabs, type PreviewTabsProps } from '../src/client/PreviewTabs.tsx'
import { parseOfficePreview, parsePlanPreview, parseSessionStatus } from '../src/client/preview-load.ts'

/** Matches ui-layout `LAYOUT_INSET_ATTR.details` (no cross-plugin value import). */
const DETAILS_INSET_ATTR = 'data-xrk-layout-details'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const t = makeTranslate(zh, commonZh)

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
        } as PreviewTabsProps)}
      />,
    )
    expect(screen.getByRole('heading', { name: '概况' })).toBeTruthy()
    await waitFor(() => {
      expect(screen.getByText('会话')).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('tab', { name: '任务' }))
    expect(screen.getByText('ship overview')).toBeTruthy()
    expect(screen.getByText('docs')).toBeTruthy()
    expect(screen.getByText('进行中')).toBeTruthy()
  })

  it('falls back to the preview RPC where plan mode is not composed', async () => {
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
        } as PreviewTabsProps)}
      />,
    )
    await waitFor(() => {
      expect(screen.getByText('会话')).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('tab', { name: '任务' }))
    expect(screen.getByText(/尚无站立计划/)).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: '计划' }))
    await waitFor(() => {
      expect(screen.getByText('计划模式')).toBeTruthy()
    })
    expect(screen.getByText('是')).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'Office' }))
    expect(screen.getByText('已配置')).toBeTruthy()
    expect(screen.getAllByText('否').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: '关闭概况栏' }))
    expect(closeDetails).toHaveBeenCalledTimes(1)
  })

  it('rides the live plan projection instead of the mount-time snapshot', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ok: false })))
    const { state, useProjection } = fakeProjections({ plan: { active: false, pending: false } })
    const props = { sessionId: 's1', closeDetails: vi.fn(), t, useProjection } as PreviewTabsProps
    const view = render(<PreviewTabs {...props} />)
    fireEvent.click(screen.getByRole('tab', { name: '计划' }))
    await waitFor(() => {
      expect(screen.getByText('计划模式')).toBeTruthy()
    })
    expect(screen.getAllByText('否').length).toBeGreaterThan(0)
    state.plan = { active: true, pending: false }
    view.rerender(<PreviewTabs {...props} />)
    expect(screen.getByText('是')).toBeTruthy()
  })

  it('binds live contextTimeline inject / compact / spill rows', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('session.status')) {
        return jsonResponse({ result: { ok: true, value: sampleStatus } })
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
        } as PreviewTabsProps)}
      />,
    )
    await waitFor(() => {
      expect(screen.getAllByText('95').length).toBeGreaterThan(0)
    })
    expect(screen.getAllByText(/skill-catalog:catalog/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/overflow/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/tokens 1200/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/修剪 1/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/落盘 1/).length).toBeGreaterThan(0)
    expect(screen.getByText('prune · spill')).toBeTruthy()
    expect(screen.getByText('compact · overflow')).toBeTruthy()
    expect(screen.getByLabelText('压缩分阶')).toBeTruthy()
    expect(screen.getByLabelText('队列 / 回合')).toBeTruthy()
  })

  it('opens spill paths from Status timeline rows via openSpillPath', async () => {
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
        } as PreviewTabsProps)}
      />,
    )
    await waitFor(() => {
      expect(screen.getByText('prune · spill')).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: '查看落盘文件' }))
    expect(openSpillPath).toHaveBeenCalledWith(
      '/home/u/.xrk/spill/tool-outputs/s_c.txt',
    )
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
    fireEvent.click(screen.getByRole('button', { name: '概况' }))
    expect(closePreview).toHaveBeenCalledTimes(1)
    expect(openPreview).not.toHaveBeenCalled()
    document.documentElement.removeAttribute(DETAILS_INSET_ATTR)
  })
})
