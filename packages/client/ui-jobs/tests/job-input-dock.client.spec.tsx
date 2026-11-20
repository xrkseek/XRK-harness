// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { makeTranslate } from '@xrkseek/client-test-runtime'
import type { SessionId, SessionListState, JobView } from '@xrkseek/client-runtime/client'
import { JobInputDock, type JobInputDockProps } from '../src/client/JobInputDock.tsx'
import { zh } from '../src/client/locales.ts'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(START)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const SESSION = 'session' as SessionId
const START = 1_700_000_000_000
const t: JobInputDockProps['t'] = makeTranslate(zh)

function job(over: Partial<JobView> = {}): JobView {
  return {
    id: 'bash-1' as JobView['id'],
    kind: 'bash',
    label: 'pnpm run build',
    status: 'running',
    startedAt: START,
    ...over,
  }
}

function props(
  jobs: readonly JobView[] | undefined,
  actions: Partial<Pick<JobInputDockProps, 'killJob' | 'backgroundJob'>> = {},
): JobInputDockProps {
  const state = {
    ids: [SESSION],
    byId: {},
    current: SESSION,
    phase: 'ready',
    subagentsByParent: {},
    jobsBySession: jobs === undefined ? {} : { [SESSION]: jobs },
    currentAddress: undefined,
  } satisfies SessionListState
  function useSessions<T>(select: (snapshot: SessionListState) => T): T {
    return select(state)
  }
  return {
    sessionId: SESSION,
    useSessions,
    t,
    killJob: actions.killJob ?? vi.fn(),
    backgroundJob: actions.backgroundJob ?? vi.fn(),
  } as unknown as JobInputDockProps
}

function rowCells(): string[][] {
  return within(screen.getByRole('list', { name: zh['list.aria'] }))
    .getAllByRole('listitem')
    .map((row) => {
      const pick = (name: string) =>
        row.querySelector(`[data-job-cell="${name}"]`)?.textContent ?? ''
      return [pick('kind'), pick('label'), pick('status'), pick('duration')]
    })
}

describe('JobInputDock visibility', () => {
  it('renders nothing when no live jobs remain', () => {
    const { container, rerender } = render(<JobInputDock {...props([
      job({ status: 'completed', finishedAt: START + 1_000 }),
    ])} />)
    expect(container.innerHTML).toBe('')

    rerender(<JobInputDock {...props([job()])} />)
    expect(screen.getByTestId('job-input-dock')).toBeDefined()
  })

  it('paints live rows without a second header chip for a single job', () => {
    render(<JobInputDock {...props([job()])} />)
    expect(screen.queryByRole('button', { name: /后台任务运行中/ })).toBeNull()
    expect(rowCells()[0]?.[1]).toBe('pnpm run build')
  })
})

describe('JobInputDock rows', () => {
  it('orders live jobs by start and ticks duration', () => {
    vi.setSystemTime(START + 1_000)
    render(<JobInputDock {...props([
      job({ id: 'bash-2' as JobView['id'], label: 'later', startedAt: START + 5_000 }),
      job({ id: 'bash-1' as JobView['id'], label: 'earlier', startedAt: START }),
    ])} />)
    fireEvent.click(screen.getByRole('button', { name: /2 个后台任务运行中/ }))
    expect(rowCells().map(cells => cells[1])).toEqual(['earlier', 'later'])
    expect(rowCells()[0]).toContain('1秒')

    act(() => { vi.advanceTimersByTime(2_000) })
    expect(rowCells()[0]).toContain('3秒')
  })
})

describe('JobInputDock actions', () => {
  it('offers stop for live jobs and routes clicks to killJob after confirm', () => {
    const killJob = vi.fn()
    render(<JobInputDock {...props([job()], { killJob })} />)
    const stop = within(screen.getByRole('list', { name: zh['list.aria'] }))
      .getByRole('button', { name: '停止任务 pnpm run build' })
    fireEvent.click(stop)
    expect(killJob).not.toHaveBeenCalled()
    fireEvent.click(within(screen.getByRole('list', { name: zh['list.aria'] }))
      .getByRole('button', { name: '再按一次确认停止' }))
    expect(killJob).toHaveBeenCalledWith('bash-1')
  })

  it('collapsed multi-job stop kills every live job, not only the oldest', () => {
    const killJob = vi.fn()
    render(<JobInputDock {...props([
      job({ id: 'bash-1' as JobView['id'], label: 'earlier', startedAt: START }),
      job({ id: 'bash-2' as JobView['id'], label: 'mid', startedAt: START + 1_000 }),
      job({ id: 'bash-3' as JobView['id'], label: 'later', startedAt: START + 2_000 }),
    ], { killJob })} />)
    expect(screen.queryByRole('list', { name: zh['list.aria'] })).toBeNull()
    const stopAll = screen.getByRole('button', { name: '停止全部 3 个后台任务' })
    fireEvent.click(stopAll)
    expect(killJob).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '再按一次确认停止全部 3 个' }))
    expect(killJob).toHaveBeenCalledTimes(3)
    expect(killJob.mock.calls.map((call) => call[0]).toSorted()).toEqual([
      'bash-1',
      'bash-2',
      'bash-3',
    ])
  })

  it('expands a row and polls jobs.output into TerminalBlock', async () => {
    vi.useRealTimers()
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, value: { text: 'hello from bash\n', truncated: false } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }))
    vi.stubGlobal('fetch', fetchImpl)
    render(<JobInputDock {...props([job()])} />)
    fireEvent.click(screen.getByRole('button', { name: '展开 pnpm run build 的输出' }))
    expect(await screen.findByText('hello from bash')).toBeTruthy()
    expect(fetchImpl).toHaveBeenCalled()
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain('/sidebar/api/jobs.output')
  })

  it('mounts output beside the list so multi-job expand does not nest scrollports', async () => {
    vi.useRealTimers()
    const long = Array.from({ length: 80 }, (_, i) => `line-${i + 1}`).join('\n')
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, value: { text: long, truncated: false } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })))
    const { container } = render(<JobInputDock {...props([
      job(),
      job({ id: 'bash-2' as JobView['id'], label: 'second', startedAt: START + 1_000 }),
    ])} />)
    fireEvent.click(screen.getByRole('button', { name: /2 个后台任务运行中/ }))
    fireEvent.click(screen.getByRole('button', { name: '展开 pnpm run build 的输出' }))
    expect(await screen.findByText('line-1')).toBeTruthy()
    const panel = container.querySelector('[class*="panel"]') as HTMLElement | null
    expect(panel).not.toBeNull()
    const list = screen.getByRole('list', { name: zh['list.aria'] })
    expect(list.contains(panel)).toBe(false)
    expect(container.querySelector('[data-output-open]')?.contains(list)).toBe(true)
    expect(getComputedStyle(panel!).overflowY).not.toMatch(/^(auto|scroll)$/)
  })

  it('keeps panel out of the scroll chain for a single live job', async () => {
    vi.useRealTimers()
    const long = Array.from({ length: 40 }, (_, i) => `line-${i + 1}`).join('\n')
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, value: { text: long, truncated: false } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })))
    const { container } = render(<JobInputDock {...props([job()])} />)
    fireEvent.click(screen.getByRole('button', { name: '展开 pnpm run build 的输出' }))
    expect(await screen.findByText('line-1')).toBeTruthy()
    const panel = container.querySelector('[class*="panel"]') as HTMLElement | null
    const list = screen.getByRole('list', { name: zh['list.aria'] })
    expect(panel).not.toBeNull()
    expect(list.contains(panel)).toBe(false)
  })

  it('offers background only for foreground running jobs', () => {
    const backgroundJob = vi.fn()
    render(<JobInputDock {...props([
      job({ foreground: true }),
      job({ id: 'bash-2' as JobView['id'], label: 'plain', foreground: false }),
    ], { backgroundJob })} />)
    fireEvent.click(screen.getByRole('button', { name: /2 个后台任务运行中/ }))
    const list = within(screen.getByRole('list', { name: zh['list.aria'] }))
    expect(list.getAllByRole('button', { name: /后台/ })).toHaveLength(1)
    fireEvent.click(list.getByRole('button', { name: '将任务 pnpm run build 移至后台' }))
    expect(backgroundJob).toHaveBeenCalledWith('bash-1')
  })
})
