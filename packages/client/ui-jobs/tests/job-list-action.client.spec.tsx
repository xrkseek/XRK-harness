// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { makeTranslate } from '@xrkseek/client-test-runtime'
import type { SessionId, SessionListState, JobView } from '@xrkseek/client-runtime/client'
import { JobListAction, type JobListActionProps } from '../src/client/JobListAction.tsx'
import { zh } from '../src/client/locales.ts'

// Live rows render `now - startedAt`, so every assertion needs a pinned clock.
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
const t: JobListActionProps['t'] = makeTranslate(zh)

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
  actions: Partial<Pick<JobListActionProps, 'killJob' | 'backgroundJob'>> = {},
): JobListActionProps {
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
  } as unknown as JobListActionProps
}

/**
 * Rows in render order as `[kind, label, status, duration]`.
 */
function rowCells(): string[][] {
  return within(screen.getByRole('list', { name: zh['list.aria'] }))
    .getAllByRole('listitem')
    .map((row) => {
      const pick = (name: string) =>
        row.querySelector(`[data-job-cell="${name}"]`)?.textContent ?? ''
      return [pick('kind'), pick('label'), pick('status'), pick('duration')]
    })
}

describe('JobListAction visibility', () => {
  it('renders nothing while the session has no jobs', () => {
    const { container } = render(<JobListAction {...props(undefined)} />)
    expect(container.innerHTML).toBe('')
  })

  it('counts only live jobs, and falls back to the total when none are live', () => {
    const { rerender } = render(<JobListAction {...props([job(), job({ id: 'bash-2' as JobView['id'] })])} />)
    expect(screen.getByRole('button', { name: '2 个后台任务运行中' })).toBeDefined()

    rerender(<JobListAction {...props([job({ status: 'completed', finishedAt: START + 3_000 })])} />)
    expect(screen.getByRole('button', { name: '1 个后台任务' })).toBeDefined()
  })

  it('closes and unmounts when the last job disappears while the list is open', () => {
    const { container, rerender } = render(<JobListAction {...props([job()])} />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByRole('list', { name: zh['list.aria'] })).toBeDefined()

    rerender(<JobListAction {...props([])} />)
    expect(container.innerHTML).toBe('')
  })
})

describe('JobListAction rows', () => {
  it('orders live jobs by start, then settled jobs newest-first', () => {
    render(<JobListAction {...props([
      job({ id: 'bash-3' as JobView['id'], label: 'old done', status: 'completed', startedAt: START, finishedAt: START + 1_000 }),
      job({ id: 'bash-4' as JobView['id'], label: 'new done', status: 'failed', startedAt: START, finishedAt: START + 9_000 }),
      job({ id: 'bash-2' as JobView['id'], label: 'later live', startedAt: START + 5_000 }),
      job({ id: 'bash-1' as JobView['id'], label: 'earlier live', startedAt: START }),
    ])} />)
    fireEvent.click(screen.getByRole('button'))
    expect(rowCells()).toEqual([
      ['bash', 'earlier live', '运行中', '0秒'],
      ['bash', 'later live', '运行中', '0秒'],
      ['bash', 'new done', '已失败', '9秒'],
      ['bash', 'old done', '已完成', '1秒'],
    ])
  })

  it('breaks a settled tie on start order so map iteration never decides it', () => {
    render(<JobListAction {...props([
      job({ id: 'bash-2' as JobView['id'], label: 'second', status: 'completed', startedAt: START + 10, finishedAt: START + 100 }),
      job({ id: 'bash-1' as JobView['id'], label: 'first', status: 'completed', startedAt: START, finishedAt: START + 100 }),
    ])} />)
    fireEvent.click(screen.getByRole('button'))
    expect(rowCells().map(cells => cells[1])).toEqual(['first', 'second'])
  })

  it('keeps the status word and appends producer detail', () => {
    render(<JobListAction {...props([
      job({ status: 'killed', detail: 'signal: SIGTERM', finishedAt: START + 2_000 }),
    ])} />)
    fireEvent.click(screen.getByRole('button'))
    expect(rowCells()[0]?.[2]).toBe('已取消 · signal: SIGTERM')
  })

  it('renders every status word, including the stopping transition', () => {
    render(<JobListAction {...props([
      job({ id: 'bash-1' as JobView['id'], label: 'a', status: 'running' }),
      job({ id: 'bash-2' as JobView['id'], label: 'b', status: 'stopping' }),
      job({ id: 'bash-3' as JobView['id'], label: 'c', status: 'completed', finishedAt: START }),
      job({ id: 'bash-4' as JobView['id'], label: 'd', status: 'killed', finishedAt: START }),
      job({ id: 'bash-5' as JobView['id'], label: 'e', status: 'failed', finishedAt: START }),
    ])} />)
    fireEvent.click(screen.getByRole('button'))
    const words = rowCells().map(cells => cells[2])
    expect(new Set(words)).toEqual(new Set(['运行中', '正在停止', '已完成', '已取消', '已失败']))
  })
})

describe('JobListAction duration', () => {
  it('advances a live row once per second and freezes a settled one', () => {
    vi.setSystemTime(START + 1_000)
    render(<JobListAction {...props([
      job({ id: 'bash-1' as JobView['id'], label: 'live' }),
      job({ id: 'bash-2' as JobView['id'], label: 'done', status: 'completed', finishedAt: START + 4_000 }),
    ])} />)
    fireEvent.click(screen.getByRole('button'))
    expect(rowCells()[0]).toContain('1秒')
    expect(rowCells()[1]).toContain('4秒')

    act(() => { vi.advanceTimersByTime(2_000) })
    expect(rowCells()[0]).toContain('3秒')
    expect(rowCells()[1]).toContain('4秒')
  })

  it('shows tenths under ten seconds so sub-second settles are not zero', () => {
    render(<JobListAction {...props([
      job({ id: 'bash-1' as JobView['id'], label: 'fast', status: 'completed', finishedAt: START + 450 }),
      job({ id: 'bash-2' as JobView['id'], label: 'exit', status: 'completed', detail: 'exit code: 0', finishedAt: START + 1_250 }),
    ])} />)
    fireEvent.click(screen.getByRole('button'))
    expect(rowCells().map(cells => [cells[1], cells[2], cells[3]])).toEqual([
      ['exit', '已完成 · exit code: 0', '1.3秒'],
      ['fast', '已完成', '0.5秒'],
    ])
  })

  it('widens to minutes and then hours, and never shows a negative figure', () => {
    render(<JobListAction {...props([
      job({ id: 'bash-1' as JobView['id'], label: 'm', status: 'completed', finishedAt: START + 125_000 }),
      job({ id: 'bash-2' as JobView['id'], label: 'h', status: 'completed', finishedAt: START + 7_380_000 }),
      // A clock that moved backwards must not render a negative duration.
      job({ id: 'bash-3' as JobView['id'], label: 'skew', status: 'completed', startedAt: START + 5_000, finishedAt: START }),
    ])} />)
    fireEvent.click(screen.getByRole('button'))
    expect(rowCells().map(cells => cells[3])).toEqual(['2小时3分', '2分5秒', '0秒'])
  })

  it('runs no clock while the list is closed', () => {
    const interval = vi.spyOn(globalThis, 'setInterval')
    render(<JobListAction {...props([job()])} />)
    expect(interval).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button'))
    expect(interval).toHaveBeenCalledTimes(1)
  })

  it('runs no clock for an open list holding only settled jobs', () => {
    const interval = vi.spyOn(globalThis, 'setInterval')
    render(<JobListAction {...props([job({ status: 'completed', finishedAt: START })])} />)
    fireEvent.click(screen.getByRole('button'))
    expect(interval).not.toHaveBeenCalled()
  })
})

describe('JobListAction dismissal', () => {
  it('closes on Escape and returns focus to the trigger', () => {
    render(<JobListAction {...props([job()])} />)
    const trigger = screen.getByRole('button', { name: '1 个后台任务运行中' })
    fireEvent.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(document.body.querySelector('[data-job-list-portal]')).not.toBeNull()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(trigger)
    expect(document.body.querySelector('[data-job-list-portal]')).toBeNull()
  })

  it('ignores other keys and a closed-list Escape', () => {
    render(<JobListAction {...props([job()])} />)
    const trigger = screen.getByRole('button', { name: '1 个后台任务运行中' })
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(trigger.getAttribute('aria-expanded')).toBe('false')

    fireEvent.click(trigger)
    fireEvent.keyDown(document, { key: 'ArrowDown' })
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
  })

  it('portals above the Overview strip and clamps away from details inset', () => {
    document.documentElement.style.setProperty('--xrk-layout-inset-details', '320px')
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1200 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 })
    render(
      <div style={{ position: 'absolute', left: 980, top: 40 }}>
        <JobListAction {...props([job()])} />
      </div>,
    )
    const trigger = screen.getByRole('button', { name: '1 个后台任务运行中' })
    // Trigger sits against the Overview edge — end-align would spill into details.
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({
      x: 980, y: 40, left: 980, top: 40, right: 1100, bottom: 68,
      width: 120, height: 28, toJSON: () => ({}),
    } as DOMRect)
    fireEvent.click(trigger)
    const portal = document.body.querySelector('[data-job-list-portal]') as HTMLElement
    expect(portal).not.toBeNull()
    expect(portal.parentElement).toBe(document.body)
    // Clamped so the 420px card stays left of details (1200 - 320 - 12 - 420).
    expect(Number.parseFloat(portal.style.left)).toBe(1200 - 320 - 12 - 420)
  })

  it('closes on an outside pointer press but not on one inside', () => {
    render(<JobListAction {...props([job()])} />)
    const trigger = screen.getByRole('button', { name: '1 个后台任务运行中' })
    fireEvent.click(trigger)

    fireEvent.pointerDown(screen.getByRole('list', { name: zh['list.aria'] }))
    expect(trigger.getAttribute('aria-expanded')).toBe('true')

    fireEvent.pointerDown(document.body)
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
  })
})

describe('JobListAction actions', () => {
  it('offers stop for live jobs and routes clicks to killJob after confirm', () => {
    const killJob = vi.fn()
    render(<JobListAction {...props([job()], { killJob })} />)
    fireEvent.click(screen.getByRole('button', { name: '1 个后台任务运行中' }))
    const stop = within(screen.getByRole('list', { name: zh['list.aria'] }))
      .getByRole('button', { name: '停止任务 pnpm run build' })
    fireEvent.click(stop)
    expect(killJob).not.toHaveBeenCalled()
    fireEvent.click(within(screen.getByRole('list', { name: zh['list.aria'] }))
      .getByRole('button', { name: '再按一次确认停止' }))
    expect(killJob).toHaveBeenCalledWith('bash-1')
  })

  it('expands a row and polls jobs.output into TerminalBlock', async () => {
    vi.useRealTimers()
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, value: { text: 'hello from bash\n', truncated: false } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }))
    vi.stubGlobal('fetch', fetchImpl)
    render(<JobListAction {...props([job()])} />)
    fireEvent.click(screen.getByRole('button', { name: '1 个后台任务运行中' }))
    fireEvent.click(screen.getByRole('button', { name: '展开 pnpm run build 的输出' }))
    expect(await screen.findByText('hello from bash')).toBeTruthy()
    expect(fetchImpl).toHaveBeenCalled()
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain('/sidebar/api/jobs.output')
  })

  it('offers background only for foreground running jobs', () => {
    const backgroundJob = vi.fn()
    render(<JobListAction {...props([
      job({ foreground: true }),
      job({ id: 'bash-2' as JobView['id'], label: 'plain', foreground: false }),
    ], { backgroundJob })} />)
    fireEvent.click(screen.getByRole('button'))
    const list = within(screen.getByRole('list', { name: zh['list.aria'] }))
    expect(list.getAllByRole('button', { name: /后台/ })).toHaveLength(1)
    fireEvent.click(list.getByRole('button', { name: '将任务 pnpm run build 移至后台' }))
    expect(backgroundJob).toHaveBeenCalledWith('bash-1')
  })
})

describe('JobListAction wire tolerance', () => {
  it('treats a settled job with no finishedAt as zero-duration and sorts it by start', () => {
    // `finishedAt` is optional on the wire; the Host always sets it, so this
    // covers a producer or carrier that ever stops doing so.
    render(<JobListAction {...props([
      job({ id: 'bash-1' as JobView['id'], label: 'no finish', status: 'completed' }),
      job({ id: 'bash-2' as JobView['id'], label: 'finished', status: 'completed', startedAt: START - 1_000, finishedAt: START + 2_000 }),
    ])} />)
    fireEvent.click(screen.getByRole('button'))
    expect(rowCells().map(cells => [cells[1], cells[3]])).toEqual([
      ['finished', '3秒'],
      ['no finish', '0秒'],
    ])
  })

  it('falls back to start order when neither settled job carries a finish time', () => {
    render(<JobListAction {...props([
      job({ id: 'bash-2' as JobView['id'], label: 'later', status: 'failed', startedAt: START + 1_000 }),
      job({ id: 'bash-1' as JobView['id'], label: 'earlier', status: 'failed', startedAt: START }),
    ])} />)
    fireEvent.click(screen.getByRole('button'))
    expect(rowCells().map(cells => cells[1])).toEqual(['later', 'earlier'])
  })
})
