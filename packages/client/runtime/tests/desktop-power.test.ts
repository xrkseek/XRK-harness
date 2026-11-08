import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  resetDesktopPreventIdleSleepTurnRunningForTests,
  syncDesktopPreventIdleSleepTurnRunning,
} from '../src/client/sessions/desktop-power.ts'

afterEach(() => {
  resetDesktopPreventIdleSleepTurnRunningForTests()
  delete (globalThis as { xrkDesktop?: unknown }).xrkDesktop
})

describe('syncDesktopPreventIdleSleepTurnRunning', () => {
  it('no-ops without a Desktop bridge and retries after mount', () => {
    const setTurnRunning = vi.fn(async () => ({}))
    syncDesktopPreventIdleSleepTurnRunning(true)
    expect(setTurnRunning).not.toHaveBeenCalled()

    ;(globalThis as {
      xrkDesktop?: { preventIdleSleep: { setTurnRunning: typeof setTurnRunning } }
    }).xrkDesktop = { preventIdleSleep: { setTurnRunning } }

    syncDesktopPreventIdleSleepTurnRunning(true)
    expect(setTurnRunning).toHaveBeenCalledTimes(1)
    expect(setTurnRunning).toHaveBeenCalledWith(true)

    syncDesktopPreventIdleSleepTurnRunning(true)
    expect(setTurnRunning).toHaveBeenCalledTimes(1)

    syncDesktopPreventIdleSleepTurnRunning(false)
    expect(setTurnRunning).toHaveBeenCalledTimes(2)
    expect(setTurnRunning).toHaveBeenLastCalledWith(false)
  })

  it('allows retry after a bridge invoke failure', async () => {
    const setTurnRunning = vi.fn(async () => {
      throw new Error('quit')
    })
    ;(globalThis as {
      xrkDesktop?: { preventIdleSleep: { setTurnRunning: typeof setTurnRunning } }
    }).xrkDesktop = { preventIdleSleep: { setTurnRunning } }

    syncDesktopPreventIdleSleepTurnRunning(true)
    expect(setTurnRunning).toHaveBeenCalledTimes(1)
    await Promise.resolve()
    await Promise.resolve()

    setTurnRunning.mockImplementation(async () => ({}))
    syncDesktopPreventIdleSleepTurnRunning(true)
    expect(setTurnRunning).toHaveBeenCalledTimes(2)
  })
})
