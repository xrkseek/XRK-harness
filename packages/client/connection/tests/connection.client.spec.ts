/**
 * ConnectionController: stream pumping into sinks, the strict readiness
 * handshake (describe + both streams' onOpen, timeout-guarded), generation
 * abort on loss, backoff reconnection, state transitions, and sink-exception
 * isolation. Real (short) timers �?the timeout and backoff are configurable,
 * so tests run them at millisecond scale.
 */

import { describe, expect, it, vi } from 'vitest'
import type { SessionId } from '../src/client/api.ts'
import type { ConnectionState } from '../src/client/connection.ts'
import { ConnectionController } from '../src/client/connection.ts'
import { FakeApiClient, deferred, ok } from './fake-api.client.ts'

const SID = 'fk-c1' as SessionId
const FAST = { backoffBaseMs: 10, backoffFactor: 1, backoffMaxMs: 10, streamOpenTimeoutMs: 500 }

function subscribedFrame(lastSeq = 0) {
  return { type: 'session/subscribed', sessionId: SID, lastSeq } as const
}

describe('connection lifecycle', () => {
  it('announces connected after describe + both streams open, then pumps frames to sinks', async () => {
    const api = new FakeApiClient()
    const muxSeen: string[] = []
    const descriptions: boolean[] = []
    let connected = 0
    const controller = new ConnectionController(api, {
      onMuxEnvelope: envelope => muxSeen.push(envelope.payload.type),
      onConnected: (description) => {
        connected++
        descriptions.push(description.canOpenPath)
      },
    }, FAST)
    controller.start()
    try {
      await vi.waitFor(() => { expect(connected).toBe(1) })
      api.pushMux(subscribedFrame())
      await vi.waitFor(() => { expect(muxSeen).toEqual(['session/subscribed']) })
      expect(api.callsOf('host.describe')).toHaveLength(1)
      expect(descriptions).toEqual([true])
    } finally {
      controller.stop()
    }
  })

  it('reconnects with a fresh generation when a stream fails, and stop() ends the loop', async () => {
    const api = new FakeApiClient()
    let connected = 0
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const controller = new ConnectionController(api, { onConnected: () => { connected++ } }, FAST)
    controller.start()
    try {
      await vi.waitFor(() => { expect(connected).toBe(1) })
      api.failStreams(new Error('stream torn'))
      await vi.waitFor(() => { expect(connected).toBe(2) }) // new generation after backoff
      expect(api.openMuxCount).toBe(1) // the dead generation's stream is gone, exactly one live
    } finally {
      controller.stop()
      warnSpy.mockRestore()
    }
    // stop() aborts the live generation (streams tear down) and no reconnect follows.
    await vi.waitFor(() => { expect(api.openMuxCount).toBe(0) })
    await new Promise(resolve => setTimeout(resolve, 40))
    expect(api.openMuxCount).toBe(0)
  })

  it('treats describe failure as generation failure and retries', async () => {
    const api = new FakeApiClient()
    const gate = deferred<Awaited<ReturnType<FakeApiClient['onDescribe']>>>()
    let describeCalls = 0
    api.onDescribe = () => {
      describeCalls++
      return describeCalls === 1 ? Promise.reject(new Error('host down')) : gate.promise
    }
    let connected = 0
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const controller = new ConnectionController(api, { onConnected: () => { connected++ } }, FAST)
    controller.start()
    try {
      await vi.waitFor(() => { expect(describeCalls).toBe(2) }) // retried after backoff
      expect(connected).toBe(0) // never announced during the failed generation
      gate.resolve(ok({ version: '0', cwd: '/f', home: '/home/u', attachedSessions: 0, canOpenPath: true }))
      await vi.waitFor(() => { expect(connected).toBe(1) })
    } finally {
      controller.stop()
      warnSpy.mockRestore()
    }
  })

  it('treats a host.describe business error as generation failure', async () => {
    const api = new FakeApiClient()
    let describeCalls = 0
    api.onDescribe = () => {
      describeCalls += 1
      if (describeCalls === 1) {
        return Promise.resolve({
          rpcId: 'bad-describe' as never,
          result: {
            ok: false as const,
            error: { code: 'internal' as const, message: 'not ready', details: {} },
          },
        })
      }
      return Promise.resolve(ok({ version: '0', cwd: '/f', home: '/home/u', attachedSessions: 0, canOpenPath: true }))
    }
    let connected = 0
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const controller = new ConnectionController(api, { onConnected: () => { connected++ } }, FAST)
    controller.start()
    try {
      await vi.waitFor(() => { expect(describeCalls).toBe(2) })
      await vi.waitFor(() => { expect(connected).toBe(1) })
    } finally {
      controller.stop()
      warnSpy.mockRestore()
    }
  })

  it('converges stream/error frames into reconnect instead of dispatching them', async () => {
    const api = new FakeApiClient()
    const muxSeen: string[] = []
    let connected = 0
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const controller = new ConnectionController(api, {
      onMuxEnvelope: envelope => muxSeen.push(envelope.payload.type),
      onConnected: () => { connected++ },
    }, FAST)
    controller.start()
    try {
      await vi.waitFor(() => { expect(connected).toBe(1) })
      api.pushMux({ type: 'stream/error', error: { code: 'internal', message: 'impl broke', details: {} } })
      await vi.waitFor(() => { expect(connected).toBe(2) }) // treated as loss �?reconnect
      expect(muxSeen).toEqual([]) // never forwarded to the business sink
    } finally {
      controller.stop()
      warnSpy.mockRestore()
    }
  })

  it('isolates sink exceptions from the pump', async () => {
    const api = new FakeApiClient()
    const seen: string[] = []
    let connected = 0
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const controller = new ConnectionController(api, {
      onMuxEnvelope: (envelope) => {
        seen.push(envelope.payload.type)
        throw new Error('business layer bug')
      },
      onConnected: () => { connected++ },
    }, FAST)
    controller.start()
    try {
      await vi.waitFor(() => { expect(connected).toBe(1) })
      api.pushMux(subscribedFrame(1))
      api.pushMux(subscribedFrame(2))
      await vi.waitFor(() => { expect(seen).toHaveLength(2) }) // second frame still pumped
      expect(connected).toBe(1) // no reconnect triggered by the sink throw
    } finally {
      controller.stop()
      errorSpy.mockRestore()
    }
  })

  it('holds onConnected until both streams establish even after describe succeeds', async () => {
    const api = new FakeApiClient()
    api.holdStreamOpen = true // describe resolves immediately; stream establishment is in the case's hand
    let connected = 0
    const controller = new ConnectionController(api, { onConnected: () => { connected++ } }, FAST)
    controller.start()
    try {
      await vi.waitFor(() => { expect(api.callsOf('host.describe')).toHaveLength(1) })
      await new Promise(resolve => setTimeout(resolve, 30))
      expect(connected).toBe(0) // describe alone must not announce
      api.releaseStreamOpens()
      await vi.waitFor(() => { expect(connected).toBe(1) })
    } finally {
      controller.stop()
    }
  })

  it('rejects a generation whose streams end during readiness and retries', async () => {
    const api = new FakeApiClient()
    const firstDescribe = deferred<Awaited<ReturnType<FakeApiClient['onDescribe']>>>()
    let describeCalls = 0
    api.onDescribe = () => {
      describeCalls++
      return describeCalls === 1
        ? firstDescribe.promise
        : Promise.resolve(ok({ version: '0', cwd: '/f', home: '/home/u', attachedSessions: 0, canOpenPath: true }))
    }
    const states: ConnectionState[] = []
    let connected = 0
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const controller = new ConnectionController(api, {
      onConnected: () => { connected++ },
      onStateChange: state => states.push(state),
    }, FAST)
    controller.start()
    try {
      await vi.waitFor(() => { expect(api.openMuxCount).toBe(1) })
      api.endStreams()
      firstDescribe.resolve(ok({ version: '0', cwd: '/f', home: '/home/u', attachedSessions: 0, canOpenPath: true }))

      await vi.waitFor(() => { expect(describeCalls).toBe(2) })
      await vi.waitFor(() => { expect(connected).toBe(1) })
      expect(states).toEqual(['reconnecting', 'connected'])
    } finally {
      controller.stop()
      warnSpy.mockRestore()
    }
  })

  it('proceeds as connected via the timeout guard when a carrier never fires onOpen', async () => {
    const api = new FakeApiClient()
    api.suppressStreamOpen = true // misbehaving carrier: streams open but onOpen never fires
    let connected = 0
    const controller = new ConnectionController(api, { onConnected: () => { connected++ } }, { ...FAST, streamOpenTimeoutMs: 20 })
    controller.start()
    try {
      await vi.waitFor(() => { expect(connected).toBe(1) }) // handshake resolved by the guard, not wedged
    } finally {
      controller.stop()
    }
  })

  it('completes describe before opening streams when describeBeforeStreams is set', async () => {
    const api = new FakeApiClient()
    const gate = deferred<ReturnType<typeof ok>>()
    let describeCalls = 0
    api.onDescribe = () => {
      describeCalls++
      return gate.promise
    }
    let connected = 0
    const phases: Array<string | undefined> = []
    const controller = new ConnectionController(
      api,
      {
        onConnected: () => { connected++ },
        onPhaseChange: (phase) => { phases.push(phase) },
      },
      { ...FAST, describeBeforeStreams: true },
    )
    controller.start()
    try {
      await vi.waitFor(() => { expect(describeCalls).toBe(1) })
      expect(api.openMuxCount).toBe(0)
      expect(phases).toEqual(['handshake:describe'])
      gate.resolve(ok({ version: '0', cwd: '/f', home: '/home/u', attachedSessions: 0, canOpenPath: true }))
      await vi.waitFor(() => { expect(connected).toBe(1) })
      expect(api.openMuxCount).toBe(1)
      expect(phases).toEqual(['handshake:describe', 'handshake:streams', undefined])
    } finally {
      controller.stop()
    }
  })

  it('waits on waitUntil before describe and reports handshake:host', async () => {
    const api = new FakeApiClient()
    let describeCalls = 0
    api.onDescribe = () => {
      describeCalls++
      return Promise.resolve(ok({ version: '0', cwd: '/f', home: '/home/u', attachedSessions: 0, canOpenPath: true }))
    }
    let releaseHost!: () => void
    const hostGate = new Promise<void>((resolve) => { releaseHost = resolve })
    const phases: Array<string | undefined> = []
    let connected = 0
    const controller = new ConnectionController(
      api,
      {
        onConnected: () => { connected++ },
        onPhaseChange: (phase) => { phases.push(phase) },
      },
      {
        ...FAST,
        waitUntil: () => hostGate,
        waitUntilTimeoutMs: 0,
      },
    )
    controller.start()
    try {
      await vi.waitFor(() => { expect(phases).toContain('handshake:host') })
      expect(describeCalls).toBe(0)
      releaseHost()
      await vi.waitFor(() => { expect(connected).toBe(1) })
      expect(describeCalls).toBe(1)
      expect(phases[0]).toBe('handshake:host')
    } finally {
      controller.stop()
    }
  })

  /**
   * waitUntil failure modes (Desktop Host gate):
   * | cause              | next phase      | auto-retry waitUntil | needs reconnect() |
   * |--------------------|-----------------|----------------------|-------------------|
   * | timed out          | retry:backoff   | yes                  | no                |
   * | sticky / hard fail | retry:halted    | no (parked)          | yes               |
   */
  describe('waitUntil failure modes', () => {
    it('timeout → retry:backoff and auto-retries waitUntil', async () => {
      const api = new FakeApiClient()
      const phases: Array<string | undefined> = []
      const states: ConnectionState[] = []
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      let describeCalls = 0
      api.onDescribe = () => {
        describeCalls += 1
        return Promise.resolve(ok({
          version: '0', cwd: '/f', home: '/home/u', attachedSessions: 0, canOpenPath: true,
        }))
      }
      let releaseHost!: () => void
      const hostGate = new Promise<void>((resolve) => { releaseHost = resolve })
      let waitCalls = 0
      const controller = new ConnectionController(
        api,
        {
          onPhaseChange: (phase) => { phases.push(phase) },
          onStateChange: (state) => { states.push(state) },
        },
        {
          ...FAST,
          waitUntilTimeoutMs: 20,
          waitUntil: () => {
            waitCalls += 1
            return waitCalls === 1 ? new Promise<void>(() => {}) : hostGate
          },
        },
      )
      controller.start()
      try {
        await vi.waitFor(() => { expect(phases).toContain('handshake:host') })
        await vi.waitFor(() => { expect(phases).toContain('retry:backoff') })
        expect(phases).not.toContain('retry:halted')
        expect(states).toContain('reconnecting')
        expect(describeCalls).toBe(0)
        await vi.waitFor(() => { expect(waitCalls).toBeGreaterThanOrEqual(2) })
        releaseHost()
        await vi.waitFor(() => { expect(describeCalls).toBe(1) })
        expect(phases).not.toContain('retry:halted')
      } finally {
        warnSpy.mockRestore()
        controller.stop()
      }
    })

    it('non-timeout reject → retry:halted and does not spin waitUntil', async () => {
      const api = new FakeApiClient()
      const phases: Array<string | undefined> = []
      const states: ConnectionState[] = []
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      let describeCalls = 0
      api.onDescribe = () => {
        describeCalls += 1
        return Promise.resolve(ok({
          version: '0', cwd: '/f', home: '/home/u', attachedSessions: 0, canOpenPath: true,
        }))
      }
      let waitCalls = 0
      let releaseHost!: () => void
      const hostGate = new Promise<void>((resolve) => { releaseHost = resolve })
      const controller = new ConnectionController(
        api,
        {
          onPhaseChange: (phase) => { phases.push(phase) },
          onStateChange: (state) => { states.push(state) },
        },
        {
          ...FAST,
          waitUntilTimeoutMs: 0,
          waitUntil: () => {
            waitCalls += 1
            if (waitCalls === 1) return Promise.reject(new Error('[OOM] sticky host failed'))
            return hostGate
          },
        },
      )
      controller.start()
      try {
        await vi.waitFor(() => { expect(phases).toContain('retry:halted') })
        expect(phases).not.toContain('retry:backoff')
        expect(states).toContain('reconnecting')
        expect(waitCalls).toBe(1)
        expect(describeCalls).toBe(0)
        // Parked: must not empty-spin waitUntil → reject forever.
        await new Promise(resolve => setTimeout(resolve, 60))
        expect(waitCalls).toBe(1)
        expect(phases.filter((phase) => phase === 'retry:halted')).toHaveLength(1)
        expect(phases).not.toContain('retry:backoff')

        controller.reconnect()
        releaseHost()
        await vi.waitFor(() => { expect(describeCalls).toBe(1) })
        expect(waitCalls).toBe(2)
      } finally {
        warnSpy.mockRestore()
        controller.stop()
      }
    })
  })

  it('kickFromHostReady does not abort the first generation during handshake:host', async () => {
    // Same hostReady pulse that resolves waitUntil must not also reconnect():
    // that aborts describe/streams of the first good generation (double-click feel).
    const api = new FakeApiClient()
    const phases: Array<string | undefined> = []
    let describeCalls = 0
    api.onDescribe = () => {
      describeCalls += 1
      return Promise.resolve(ok({
        version: '0', cwd: '/f', home: '/home/u', attachedSessions: 0, canOpenPath: true,
      }))
    }
    let waitCalls = 0
    let releaseHost!: () => void
    const hostGate = new Promise<void>((resolve) => { releaseHost = resolve })
    const controller = new ConnectionController(
      api,
      { onPhaseChange: (phase) => { phases.push(phase) } },
      {
        ...FAST,
        waitUntilTimeoutMs: 0,
        waitUntil: () => {
          waitCalls += 1
          return hostGate
        },
      },
    )
    controller.start()
    try {
      await vi.waitFor(() => { expect(phases).toContain('handshake:host') })
      expect(waitCalls).toBe(1)
      expect(describeCalls).toBe(0)

      controller.kickFromHostReady()
      await new Promise(resolve => setTimeout(resolve, 40))
      expect(waitCalls).toBe(1)
      expect(describeCalls).toBe(0)
      expect(phases.filter((phase) => phase === 'handshake:host')).toHaveLength(1)
      expect(phases).not.toContain('retry:backoff')
      expect(phases).not.toContain('retry:halted')

      releaseHost()
      await vi.waitFor(() => { expect(describeCalls).toBe(1) })
      expect(waitCalls).toBe(1)
      expect(api.callsOf('host.describe')).toHaveLength(1)
    } finally {
      controller.stop()
    }
  })

  it('kickFromHostReady reconnects from retry:halted (not while handshake:host)', async () => {
    const api = new FakeApiClient()
    const phases: Array<string | undefined> = []
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    let describeCalls = 0
    api.onDescribe = () => {
      describeCalls += 1
      return Promise.resolve(ok({
        version: '0', cwd: '/f', home: '/home/u', attachedSessions: 0, canOpenPath: true,
      }))
    }
    let waitCalls = 0
    let releaseHost!: () => void
    const hostGate = new Promise<void>((resolve) => { releaseHost = resolve })
    const controller = new ConnectionController(
      api,
      { onPhaseChange: (phase) => { phases.push(phase) } },
      {
        ...FAST,
        waitUntilTimeoutMs: 0,
        waitUntil: () => {
          waitCalls += 1
          if (waitCalls === 1) return Promise.reject(new Error('sticky'))
          return hostGate
        },
      },
    )
    controller.start()
    try {
      await vi.waitFor(() => { expect(phases).toContain('retry:halted') })
      expect(waitCalls).toBe(1)
      expect(describeCalls).toBe(0)
      controller.kickFromHostReady()
      await vi.waitFor(() => { expect(waitCalls).toBe(2) })
      expect(describeCalls).toBe(0)
      releaseHost()
      await vi.waitFor(() => { expect(describeCalls).toBe(1) })
      expect(waitCalls).toBe(2)
    } finally {
      warnSpy.mockRestore()
      controller.stop()
    }
  })

  it('emits deduplicated connected/reconnecting state transitions', async () => {
    const api = new FakeApiClient()
    const states: ConnectionState[] = []
    let connected = 0
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const controller = new ConnectionController(api, {
      onConnected: () => { connected++ },
      onStateChange: state => states.push(state),
    }, FAST)
    controller.start()
    try {
      await vi.waitFor(() => { expect(connected).toBe(1) })
      expect(states).toEqual(['connected'])
      api.failStreams(new Error('torn'))
      await vi.waitFor(() => { expect(connected).toBe(2) })
      expect(states).toEqual(['connected', 'reconnecting', 'connected'])
    } finally {
      controller.stop()
      warnSpy.mockRestore()
    }
  })

  it('does not announce a generation stopped synchronously by its connected state sink', async () => {
    const api = new FakeApiClient()
    const states: ConnectionState[] = []
    let connected = 0
    const controller = new ConnectionController(api, {
      onConnected: () => { connected++ },
      onStateChange: (state) => {
        states.push(state)
        if (state === 'connected') controller.stop()
      },
    }, FAST)

    controller.start()
    await vi.waitFor(() => { expect(states).toEqual(['connected']) })
    await vi.waitFor(() => { expect(api.openMuxCount).toBe(0) })
    expect(connected).toBe(0)
  })

  it('deduplicates consecutive reconnecting emissions across two straight failures', async () => {
    const api = new FakeApiClient()
    const gate = deferred<Awaited<ReturnType<FakeApiClient['onDescribe']>>>()
    let describeCalls = 0
    api.onDescribe = () => {
      describeCalls++
      return describeCalls <= 2 ? Promise.reject(new Error('down')) : gate.promise
    }
    const states: ConnectionState[] = []
    let connected = 0
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const controller = new ConnectionController(api, {
      onConnected: () => { connected++ },
      onStateChange: state => states.push(state),
    }, FAST)
    controller.start()
    try {
      await vi.waitFor(() => { expect(describeCalls).toBe(3) })
      gate.resolve(ok({ version: '0', cwd: '/f', home: '/home/u', attachedSessions: 0, canOpenPath: true }))
      await vi.waitFor(() => { expect(connected).toBe(1) })
      expect(states).toEqual(['reconnecting', 'connected']) // two failures, one reconnecting emission
    } finally {
      controller.stop()
      warnSpy.mockRestore()
    }
  })

  it('runs with no sinks at all (every callback slot optional)', async () => {
    const api = new FakeApiClient()
    const controller = new ConnectionController(api, {}, FAST)
    controller.start()
    try {
      await vi.waitFor(() => { expect(api.callsOf('host.describe')).toHaveLength(1) })
      api.pushMux(subscribedFrame()) // pumped with sink undefined: dropped silently
      await new Promise(resolve => setTimeout(resolve, 20))
    } finally {
      controller.stop()
    }
  })

  it('start() is idempotent (one loop, one stream set)', async () => {
    const api = new FakeApiClient()
    let connected = 0
    const controller = new ConnectionController(api, { onConnected: () => { connected++ } }, FAST)
    controller.start()
    controller.start()
    try {
      await vi.waitFor(() => { expect(connected).toBe(1) })
      expect(api.openMuxCount).toBe(1)
      expect(api.callsOf('host.describe')).toHaveLength(1)
    } finally {
      controller.stop()
    }
  })

  it('interrupts backoff and retries immediately when reconnect() is called', async () => {
    const api = new FakeApiClient()
    const gate = deferred<Awaited<ReturnType<FakeApiClient['onDescribe']>>>()
    let describeCalls = 0
    api.onDescribe = () => {
      describeCalls++
      return describeCalls === 1
        ? Promise.reject(new Error('down'))
        : gate.promise
    }
    const states: ConnectionState[] = []
    let connected = 0
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const controller = new ConnectionController(api, {
      onConnected: () => { connected++ },
      onStateChange: state => states.push(state),
    }, { ...FAST, backoffBaseMs: 5_000, backoffMaxMs: 5_000 })
    controller.start()
    try {
      await vi.waitFor(() => { expect(states).toEqual(['reconnecting']) })
      expect(describeCalls).toBe(1)
      controller.reconnect()
      await vi.waitFor(() => { expect(describeCalls).toBe(2) })
      gate.resolve(ok({ version: '0', cwd: '/f', home: '/home/u', attachedSessions: 0, canOpenPath: true }))
      await vi.waitFor(() => { expect(connected).toBe(1) })
      expect(states).toEqual(['reconnecting', 'connected'])
    } finally {
      controller.stop()
      warnSpy.mockRestore()
    }
  })
})
