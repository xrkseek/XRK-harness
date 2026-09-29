import type { HostDescription, IApiClient, HostFrame, MuxFrame, RpcRequest } from './api.ts'

/** Reconnect/backoff tunables (deployment-varying — no hardcoded tunables; these become the
 *  future `ctx.connection` plugin's Config). All fields optional; defaults below. */
export interface ConnectionConfig {
  /** First-retry backoff cap in ms (jittered: actual delay is cap/2..cap). */
  backoffBaseMs?: number
  /** Exponential growth factor per consecutive failed attempt. */
  backoffFactor?: number
  /** Upper bound for the backoff cap in ms. */
  backoffMaxMs?: number
  /** Cap on waiting for both streams' onOpen before onConnected, in ms. The strict handshake
   *  waits for mux+host stream establishment plus describe; a carrier that never
   *  fires onOpen (misbehaving proxy) must not wedge the connection forever — on timeout the
   *  generation proceeds as connected and the live-gap repair path covers stragglers. */
  streamOpenTimeoutMs?: number
  /**
   * Complete `host.describe` before opening mux/host streams.
   * Desktop `xrk-app://` allows few concurrent custom-protocol fetches; opening SSE
   * first starves unary and freezes the UI on 「连接中」.
   */
  describeBeforeStreams?: boolean
  /**
   * Optional gate before each handshake (Desktop: wait until Host Fetch is
   * attached so first paint does not burn into retry:backoff).
   */
  waitUntil?: () => Promise<void>
}

/** Resolved tunables; `waitUntil` stays optional (Desktop Host gate only). */
type ConnectionConfigResolved = Required<
  Omit<ConnectionConfig, 'waitUntil'>
> & {
  waitUntil?: ConnectionConfig['waitUntil']
}

const CONNECTION_DEFAULTS: ConnectionConfigResolved = {
  backoffBaseMs: 500,
  backoffFactor: 2,
  backoffMaxMs: 10_000,
  streamOpenTimeoutMs: 3_000,
  describeBeforeStreams: false,
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(done, ms)
    signal.addEventListener('abort', done, { once: true })
    function done(): void {
      clearTimeout(t)
      signal.removeEventListener('abort', done)
      resolve()
    }
  })
}

/** Coarse connection state for the UI: 'connected' after each generation's handshake,
 *  'reconnecting' the moment the generation fails (covers the whole backoff+retry span). */
export type ConnectionState = 'connected' | 'reconnecting'

/**
 * Fine-grained handshake progress for product chrome (spinner labels).
 * Parallel to {@link ConnectionState} — does not replace it.
 */
export type ConnectionPhase =
  | 'handshake:host'
  | 'handshake:describe'
  | 'handshake:streams'
  | 'retry:backoff'

/** Frame sink callbacks: the Controller owns the physical streams; business dispatch belongs to
 *  SessionManager. */
export interface ConnectionSinks {
  onMuxEnvelope?: (envelope: RpcRequest<MuxFrame>) => void
  onHostEnvelope?: (envelope: RpcRequest<HostFrame>) => void
  /** After each connection generation is established (both streams open + describe succeeded), first connect included. */
  onConnected?: (description: HostDescription) => void
  /** Coarse state transitions (deduplicated: fires only on change). The initial pre-connect
   *  span reports nothing — the UI treats "no state yet" as connecting, not as an outage. */
  onStateChange?: (state: ConnectionState) => void
  /** Handshake / backoff progress (deduplicated). Cleared (`undefined`) when connected or stopped. */
  onPhaseChange?: (phase: ConnectionPhase | undefined) => void
}

/**
 * Opens both streams and keeps iterating (pull mode: nothing reads the socket and the tap
 * never fires unless someone for-awaits), reconnecting with exponential backoff on loss.
 * State (generation/attempt) is instance-private, never in the store.
 * The pump body feeds each frame to a sink (sink exceptions must
 * not kill the pump — a broken business layer must not drag down the connection layer).
 */
export class ConnectionController {
  private generation = 0
  private attempt = 0
  private current: AbortController | null = null
  private retryIdle: AbortController | null = null
  private running = false
  private immediateRetry = false
  private lastState: ConnectionState | null = null
  private lastPhase: ConnectionPhase | undefined | null = null
  private readonly config: ConnectionConfigResolved

  constructor(
    private readonly api: IApiClient,
    private readonly sinks: ConnectionSinks = {},
    config: ConnectionConfig = {},
  ) {
    this.config = { ...CONNECTION_DEFAULTS, ...config }
  }

  /** Idempotent: begin the connect/pump/reconnect loop. */
  start(): void {
    if (this.running) return
    this.running = true
    void this.loop()
  }

  /** Stop the loop and abort the current generation's streams. */
  stop(): void {
    this.running = false
    this.current?.abort()
    this.current = null
    this.retryIdle?.abort()
    this.retryIdle = null
    this.emitPhase(undefined)
  }

  /** Reset backoff and replace the current generation or retry delay immediately. */
  reconnect(): void {
    if (!this.running) return
    this.attempt = 0
    this.immediateRetry = true
    this.current?.abort()
    this.retryIdle?.abort()
  }

  private backoffDelay(attempt: number): number {
    const { backoffBaseMs, backoffFactor, backoffMaxMs } = this.config
    const cap = Math.min(backoffMaxMs, backoffBaseMs * backoffFactor ** Math.max(0, attempt - 1))
    return cap / 2 + Math.random() * (cap / 2)
  }

  /** Read through a method: stop() flips the flag across awaits, so narrowing from the loop condition must not stick. */
  private isRunning(): boolean {
    return this.running
  }

  /** Re-read both mutable liveness guards after a potentially reentrant sink. */
  private isGenerationActive(controller: AbortController): boolean {
    return this.isRunning() && !controller.signal.aborted
  }

  private async loop(): Promise<void> {
    while (this.running) {
      const gen = ++this.generation
      const ac = new AbortController()
      this.current = ac

      /* v8 ignore next -- initializer placeholder: the Promise executor
       * below runs synchronously and replaces it before anyone can call it. */
      let muxOpened = (): void => {}
      /* v8 ignore next -- same placeholder pattern as muxOpened. */
      let hostOpened = (): void => {}
      const streamsOpen = Promise.all([
        new Promise<void>((resolve) => { muxOpened = resolve }),
        new Promise<void>((resolve) => { hostOpened = resolve }),
      ])

      let pumpsStarted = false
      /* v8 ignore next -- replaced synchronously by the Promise executor. */
      let settleFailed = (): void => {}
      const failed = new Promise<void>((resolve) => {
        settleFailed = (): void => {
          if (gen === this.generation && !ac.signal.aborted) ac.abort()
          resolve()
        }
      })
      const startPumps = (): void => {
        if (pumpsStarted) return
        pumpsStarted = true
        this.emitPhase('handshake:streams')
        void this.pumpStream(this.api.events.mux({}, ac.signal, muxOpened), this.sinks.onMuxEnvelope, settleFailed)
        void this.pumpStream(this.api.events.host({}, ac.signal, hostOpened), this.sinks.onHostEnvelope, settleFailed)
      }

      try {
        if (this.config.waitUntil) {
          this.emitPhase('handshake:host')
          await this.config.waitUntil()
          if (ac.signal.aborted) throw new Error('generation aborted while waiting for host')
        }
        // Strict readiness handshake: describe proves unary reachability, onOpen
        // proves each physical stream is established before any frame —
        // only then may onConnected fire, so the resync it triggers cannot outrun the
        // subscribed baseline. The timeout guards against a carrier that never fires onOpen
        // (see ConnectionConfig.streamOpenTimeoutMs).
        const timeout = new AbortController()
        let description: Awaited<ReturnType<IApiClient['host']['describe']>>
        this.emitPhase('handshake:describe')
        if (this.config.describeBeforeStreams) {
          // Unary first — avoid custom-protocol SSE occupying the only fetch slot.
          description = await this.api.host.describe({})
          startPumps()
          await Promise.race([streamsOpen, sleep(this.config.streamOpenTimeoutMs, timeout.signal)])
        } else {
          startPumps()
          ;[description] = await Promise.all([
            this.api.host.describe({}),
            Promise.race([streamsOpen, sleep(this.config.streamOpenTimeoutMs, timeout.signal)]),
          ])
        }
        timeout.abort()
        const descriptionResult = description.result
        if (!descriptionResult.ok) {
          throw new Error(`host.describe failed: ${descriptionResult.error.code}: ${descriptionResult.error.message}`)
        }
        if (ac.signal.aborted) throw new Error('generation aborted during readiness handshake')
        this.attempt = 0
        this.emitPhase(undefined)
        this.emitState('connected')
        // A state sink may synchronously stop this controller. Do not publish
        // a description for a generation that no longer exists afterward.
        if (this.isGenerationActive(ac)) {
          this.callSink(() => { this.sinks.onConnected?.(descriptionResult.value) })
        }
      } catch {
        // Transport failure: treat as generation failure, fall through to the shared backoff.
        if (!ac.signal.aborted) ac.abort()
        if (!pumpsStarted) settleFailed()
      }

      await failed
      if (!this.isRunning()) return
      this.emitState('reconnecting')
      this.emitPhase('retry:backoff')
      const immediate = this.immediateRetry
      this.immediateRetry = false
      if (immediate) {
        this.attempt = 0
        continue
      }
      this.attempt += 1
      console.warn(`[web-runtime] connection lost, retry #${this.attempt}`)
      const idle = new AbortController()
      this.retryIdle = idle
      await sleep(this.backoffDelay(this.attempt), idle.signal)
      if (this.retryIdle === idle) this.retryIdle = null
      if (this.immediateRetry) {
        this.immediateRetry = false
        this.attempt = 0
      }
    }
  }

  /** Deduplicated state emission (sink isolation applies). */
  private emitState(state: ConnectionState): void {
    if (this.lastState === state) return
    this.lastState = state
    this.callSink(() => this.sinks.onStateChange?.(state))
  }

  /** Deduplicated handshake-phase emission (sink isolation applies). */
  private emitPhase(phase: ConnectionPhase | undefined): void {
    if (Object.is(this.lastPhase, phase)) return
    this.lastPhase = phase
    this.callSink(() => this.sinks.onPhaseChange?.(phase))
  }

  private async pumpStream<F extends { type: string }>(
    stream: AsyncIterable<RpcRequest<F>>,
    sink: ((envelope: RpcRequest<F>) => void) | undefined,
    onEnd: () => void,
  ): Promise<void> {
    try {
      for await (const envelope of stream) {
        if (envelope.payload.type === 'stream/error') break
        if (sink !== undefined) this.callSink(() => { sink(envelope) })
      }
    } catch {
      // Stream loss: converge on onEnd, which triggers the shared reconnect.
    }
    onEnd()
  }

  /** Sink exception isolation: a business-layer throw is logged only, never affecting pump or reconnect semantics. */
  private callSink(fn: () => void): void {
    try {
      fn()
    } catch (error) {
      console.error('[web-runtime] connection sink threw:', error)
    }
  }
}
