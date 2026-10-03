// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
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

function done(over: Partial<JobView> = {}): JobView {
  return job({ status: 'completed', finishedAt: START + 1_000, ...over })
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

  it('hides the header chip while only live jobs remain (composer dock owns that strip)', () => {
    const { container } = render(<JobListAction {...props([job()])} />)
    expect(container.innerHTML).toBe('')
  })

  it('keeps the settled chip while live jobs sit in the composer dock', () => {
    render(<JobListAction {...props([job(), done({ id: 'bash-2' as JobView['id'] })])} />)
    expect(screen.getByRole('button', { name: '1 个后台任务' })).toBeDefined()
  })

  it('counts settled jobs with idle copy', () => {
    render(<JobListAction {...props([done(), done({ id: 'bash-2' as JobView['id'] })])} />)
    expect(screen.getByRole('button', { name: '2 个后台任务' })).toBeDefined()
  })

  it('closes and unmounts when the last job disappears while the list is open', () => {
    const { container, rerender } = render(<JobListAction {...props([done()])} />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByRole('list', { name: zh['list.aria'] })).toBeDefined()

    rerender(<JobListAction {...props([])} />)
    expect(container.innerHTML).toBe('')
  })
})

describe('JobListAction rows', () => {
  it('orders settled jobs newest-first', () => {
    render(<JobListAction {...props([
      job({ id: 'bash-3' as JobView['id'], label: 'old done', status: 'completed', startedAt: START, finishedAt: START + 1_000 }),
      job({ id: 'bash-4' as JobView['id'], label: 'new done', status: 'failed', startedAt: START, finishedAt: START + 9_000 }),
    ])} />)
    fireEvent.click(screen.getByRole('button'))
    expect(rowCells()).toEqual([
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

  it('renders every settled status word', () => {
    render(<JobListAction {...props([
      job({ id: 'bash-3' as JobView['id'], label: 'c', status: 'completed', finishedAt: START }),
      job({ id: 'bash-4' as JobView['id'], label: 'd', status: 'killed', finishedAt: START }),
      job({ id: 'bash-5' as JobView['id'], label: 'e', status: 'failed', finishedAt: START }),
    ])} />)
    fireEvent.click(screen.getByRole('button'))
    const words = rowCells().map(cells => cells[2])
    expect(new Set(words)).toEqual(new Set(['已完成', '已取消', '已失败']))
  })
})

describe('JobListAction duration', () => {
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

  it('runs no clock for a closed settled list', () => {
    const interval = vi.spyOn(globalThis, 'setInterval')
    render(<JobListAction {...props([done()])} />)
    expect(interval).not.toHaveBeenCalled()
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
    render(<JobListAction {...props([done()])} />)
    const trigger = screen.getByRole('button', { name: '1 个后台任务' })
    fireEvent.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(document.body.querySelector('[data-job-list-portal]')).not.toBeNull()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(trigger)
    expect(document.body.querySelector('[data-job-list-portal]')).toBeNull()
  })

  it('ignores other keys and a closed-list Escape', () => {
    render(<JobListAction {...props([done()])} />)
    const trigger = screen.getByRole('button', { name: '1 个后台任务' })
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
        <JobListAction {...props([done()])} />
      </div>,
    )
    const trigger = screen.getByRole('button', { name: '1 个后台任务' })
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
    render(<JobListAction {...props([done()])} />)
    const trigger = screen.getByRole('button', { name: '1 个后台任务' })
    fireEvent.click(trigger)

    fireEvent.pointerDown(screen.getByRole('list', { name: zh['list.aria'] }))
    expect(trigger.getAttribute('aria-expanded')).toBe('true')

    fireEvent.pointerDown(document.body)
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
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
