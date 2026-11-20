// @vitest-environment jsdom
/**
 * QueueDock ↔ Ctrl+Enter steer flush bridge: open inline edits must commit
 * before Host steer, or the pre-edit admit body ships while the draft is lost.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  flushQueueDockEdit,
  registerQueueDockEditFlush,
} from '../src/client/queue/dock-edit-flush.ts'

afterEach(() => {
  registerQueueDockEditFlush('s1', null)
})

describe('dock-edit-flush', () => {
  it('returns idle when no dock is registered', async () => {
    await expect(flushQueueDockEdit('missing')).resolves.toBe('idle')
  })

  it('forwards flushed / failed from the registered hook', async () => {
    const flush = vi.fn(async () => 'flushed' as const)
    registerQueueDockEditFlush('s1', flush)
    await expect(flushQueueDockEdit('s1')).resolves.toBe('flushed')
    expect(flush).toHaveBeenCalledTimes(1)

    registerQueueDockEditFlush('s1', async () => 'failed')
    await expect(flushQueueDockEdit('s1')).resolves.toBe('failed')
  })

  it('clears the hook on null registration', async () => {
    registerQueueDockEditFlush('s1', async () => 'flushed')
    registerQueueDockEditFlush('s1', null)
    await expect(flushQueueDockEdit('s1')).resolves.toBe('idle')
  })
})
