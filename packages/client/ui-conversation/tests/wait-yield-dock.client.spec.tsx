// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@xrkseek/client-test-runtime'
import type { RunningToolCall, SessionId } from '@xrkseek/client-runtime/client'
import {
  WaitYieldDock,
  type WaitYieldDockProps,
} from '../src/client/skeleton/WaitYieldDock.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const t: WaitYieldDockProps['t'] = makeTranslate(zh)

function props(
  names: readonly string[],
  yieldWait: WaitYieldDockProps['yieldWait'] = vi.fn(),
): WaitYieldDockProps {
  const runningCalls = names.map((name, i) => ({
    callId: `c${i}`,
    name,
    argsRaw: '{}',
    turn: 1,
    step: 1,
    time: 1,
    callView: null,
    subCalls: [],
  })) as RunningToolCall[]
  return {
    sessionId: 's' as SessionId,
    useSession: <T,>(sel: (s: { runningCalls: readonly RunningToolCall[] }) => T) =>
      sel({ runningCalls }),
    yieldWait,
    t,
  } as unknown as WaitYieldDockProps
}

describe('WaitYieldDock', () => {
  it('hides for ordinary tools', () => {
    const { container } = render(<WaitYieldDock {...props(['bash'])} />)
    expect(container.innerHTML).toBe('')
  })

  it('calls yieldWait', () => {
    const yieldWait = vi.fn()
    render(<WaitYieldDock {...props(['wait_agent'], yieldWait)} />)
    fireEvent.click(screen.getByRole('button', { name: zh['wait.dock.detach'] }))
    expect(yieldWait).toHaveBeenCalledTimes(1)
  })

  it('shows for foreground subagent wait', () => {
    render(<WaitYieldDock {...props(['subagent'])} />)
    expect(screen.getByTestId('wait-yield-dock')).toBeTruthy()
  })
})
