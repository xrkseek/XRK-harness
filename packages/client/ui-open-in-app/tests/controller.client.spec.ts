/**
 * Open-in-app catalog must wait for Face connect — Desktop splash probes
 * otherwise leave the Overview tools strip without Explorer/Cursor.
 */
import { describe, expect, it, vi } from 'vitest'
import type { ConnectionHandle } from '@xrkseek/client-connection/client'
import { OpenInAppController } from '../src/client/controller.ts'

function fakeConnection(options: {
  readonly isLoopback?: boolean
  readonly state?: 'connected' | 'reconnecting' | undefined
  readonly canOpenPath?: boolean
  readonly apps?: readonly string[]
  readonly listThrows?: boolean
}): ConnectionHandle & {
  publishState(state: 'connected' | 'reconnecting' | undefined): void
  publishHost(canOpenPath: boolean | undefined): void
} {
  let state = options.state
  let canOpenPath = options.canOpenPath
  const stateListeners = new Set<() => void>()
  const hostListeners = new Set<() => void>()
  const listOpenInApps = vi.fn(async () => {
    if (options.listThrows) throw new Error('host down')
    return {
      result: { ok: true as const, value: { apps: [...(options.apps ?? ['explorer'])] } },
    }
  })
  return {
    isLoopback: options.isLoopback ?? true,
    api: { host: { listOpenInApps, openInApp: vi.fn() } } as never,
    hostDescription: {
      getSnapshot: () => (canOpenPath === undefined ? undefined : { canOpenPath } as never),
      subscribe: (fn) => {
        hostListeners.add(fn)
        return () => { hostListeners.delete(fn) }
      },
    },
    connectionState: {
      getSnapshot: () => state,
      subscribe: (fn) => {
        stateListeners.add(fn)
        return () => { stateListeners.delete(fn) }
      },
    },
    connectionPhase: { getSnapshot: () => undefined, subscribe: () => () => {} },
    rpc: {} as never,
    start: () => ({ stop() {} }),
    reconnect() {},
    publishState(next) {
      state = next
      for (const fn of stateListeners) fn()
    },
    publishHost(next) {
      canOpenPath = next
      for (const fn of hostListeners) fn()
    },
  }
}

describe('OpenInAppController.syncFromConnection', () => {
  it('does not probe during splash before Face is connected', async () => {
    const connection = fakeConnection({ state: undefined, canOpenPath: undefined })
    const controller = new OpenInAppController(connection)
    controller.syncFromConnection()
    await Promise.resolve()
    expect(connection.api.host.listOpenInApps).not.toHaveBeenCalled()
    expect(controller.apps.getSnapshot()).toBeNull()
  })

  it('probes once after connected + canOpenPath', async () => {
    const connection = fakeConnection({
      state: undefined,
      canOpenPath: undefined,
      apps: ['explorer', 'cursor'],
    })
    const controller = new OpenInAppController(connection)
    controller.syncFromConnection()
    connection.publishState('connected')
    controller.syncFromConnection()
    expect(connection.api.host.listOpenInApps).not.toHaveBeenCalled()
    connection.publishHost(true)
    controller.syncFromConnection()
    await controller.load()
    expect(connection.api.host.listOpenInApps).toHaveBeenCalledOnce()
    expect(controller.apps.getSnapshot()).toEqual(['explorer', 'cursor'])
    controller.syncFromConnection()
    await controller.load()
    expect(connection.api.host.listOpenInApps).toHaveBeenCalledOnce()
  })

  it('retries after a failed splash-era probe once Host is up', async () => {
    const listOpenInApps = vi.fn()
      .mockRejectedValueOnce(new Error('not ready'))
      .mockResolvedValueOnce({
        result: { ok: true as const, value: { apps: ['explorer'] } },
      })
    const connection = fakeConnection({ state: 'connected', canOpenPath: true })
    ;(connection.api.host as { listOpenInApps: typeof listOpenInApps }).listOpenInApps = listOpenInApps
    const controller = new OpenInAppController(connection)
    controller.syncFromConnection()
    await controller.load()
    expect(controller.apps.getSnapshot()).toEqual([])
    controller.syncFromConnection()
    await controller.load()
    expect(listOpenInApps).toHaveBeenCalledTimes(2)
    expect(controller.apps.getSnapshot()).toEqual(['explorer'])
  })
})
