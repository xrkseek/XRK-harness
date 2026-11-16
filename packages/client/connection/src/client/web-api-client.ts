/** Browser API carrier: HTTP upstream plus WebSocket (or SSE on `xrk-app://`) downlinks. */

import type { ApiProxy, HostFrame, MuxFrame, RpcRequest, ServerRequest } from './api.ts'
import { AbstractApiClient } from './api.ts'
import { hostFrameSchema, muxFrameSchema } from '@xrkseek/xrk-host-apiproxy/api/events.schema'
import { serverRequestSchema } from '@xrkseek/xrk-host-apiproxy/api/rpc.schema'
import { HOST_EVENTS_PATH, MUX_EVENTS_PATH } from '../api-path.ts'

type SocketItem<F> = { kind: 'frame'; envelope: RpcRequest<F> } | { kind: 'end' }
type Parser<F> = { parse(value: unknown): F }

/**
 * Face WS app-level keepalive cadence (text `: keepalive`, same interval as
 * SSE comment keepalives). Protocol Ping/Pong is invisible to the browser
 * `message` handler, so this is what the client idle watchdog measures.
 */
export const WS_DOWNLINK_KEEPALIVE_INTERVAL_MS = 15_000

/**
 * Idle deadline for one WebSocket downlink. Three missed app keepalives —
 * mirrors SSE `SSE_IDLE_TIMEOUT_MS` so a half-open socket (TCP still up,
 * no Face frames) fails into reconnect instead of leaving optimistic
 * `running` / 「思考中」 stuck forever on Mobile / Web.
 */
export const WS_DOWNLINK_IDLE_TIMEOUT_MS = WS_DOWNLINK_KEEPALIVE_INTERVAL_MS * 3

/** Face app keepalive text (SSE uses the same comment body). */
const WS_APP_KEEPALIVE_PREFIX = ':'

/**
 * Browser platform subclass: unary/respond use fetch; mux/host use WebSocket
 * on http(s), or SSE on Desktop `xrk-app://` (no WS upgrade over custom protocol).
 */
export class WebApiClient extends AbstractApiClient {
  protected doFetch(input: URL, init?: RequestInit): Promise<Response> {
    return globalThis.fetch(input, init)
  }

  /** Desktop custom protocol cannot open `ws:` — reuse AbstractApiClient SSE. */
  private usesSseDownlink(): boolean {
    try {
      return new URL(this.resolveBase()).protocol === 'xrk-app:'
    } catch {
      return false
    }
  }

  /**
   * Sibling hostname so long-lived mux SSE does not share Chromium's
   * custom-protocol connection pool with unary `xrk-app://app` RPCs.
   */
  protected override resolveStreamBase(): string {
    if (!this.usesSseDownlink()) return this.resolveBase()
    return 'xrk-app://stream'
  }

  protected override openMux(
    _payload: Parameters<ApiProxy['events']['mux']>[0]['payload'],
    signal: AbortSignal,
    onOpen?: () => void,
  ): AsyncIterable<RpcRequest<MuxFrame>> {
    if (this.usesSseDownlink()) {
      return this.readSse(MUX_EVENTS_PATH, signal, muxFrameSchema, onOpen)
    }
    return this.readWebSocket(MUX_EVENTS_PATH, signal, muxFrameSchema, onOpen)
  }

  protected override openHost(
    _payload: Parameters<ApiProxy['events']['host']>[0]['payload'],
    signal: AbortSignal,
    onOpen?: () => void,
  ): AsyncIterable<RpcRequest<HostFrame>> {
    if (this.usesSseDownlink()) {
      // Same sibling origin as mux (`xrk-app://stream`). Unary stays on
      // `xrk-app://app`, so two long-lived SSEs no longer starve describe.
      // Without this stream, host/session-* and settings/document-updated never
      // reach the shell — MCP badges and subagent header/Overview stay stale
      // until a manual refresh or session switch.
      return this.readSse(HOST_EVENTS_PATH, signal, hostFrameSchema, onOpen)
    }
    return this.readWebSocket(HOST_EVENTS_PATH, signal, hostFrameSchema, onOpen)
  }

  private async *readWebSocket<F extends MuxFrame | HostFrame>(
    path: string,
    signal: AbortSignal,
    frameSchema: Parser<F>,
    onOpen?: () => void,
  ): AsyncGenerator<RpcRequest<F>> {
    const url = new URL(path, this.resolveBase())
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    const socket = new WebSocket(url)
    const inbox: SocketItem<F>[] = []
    let wake: (() => void) | undefined
    let idleTimer: ReturnType<typeof setTimeout> | undefined
    let idleError: Error | undefined
    const clearIdle = (): void => {
      if (idleTimer === undefined) return
      clearTimeout(idleTimer)
      idleTimer = undefined
    }
    const armIdle = (): void => {
      clearIdle()
      if (signal.aborted || idleError !== undefined) return
      idleTimer = setTimeout(() => {
        idleError = new Error(
          `downlink idle for ${WS_DOWNLINK_IDLE_TIMEOUT_MS}ms on ${path}: expected app traffic every ${WS_DOWNLINK_KEEPALIVE_INTERVAL_MS}ms`,
        )
        wake?.()
        wake = undefined
        if (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN) {
          socket.close()
        }
      }, WS_DOWNLINK_IDLE_TIMEOUT_MS)
    }
    const noteActivity = (): void => {
      if (idleError !== undefined) return
      armIdle()
    }
    const enqueue = (item: SocketItem<F>): void => {
      inbox.push(item)
      wake?.()
      wake = undefined
    }
    const handleOpen = (): void => {
      noteActivity()
      onOpen?.()
    }
    const handleMessage = (event: MessageEvent): void => {
      // Any app byte (including Face `: keepalive`) proves the channel is live.
      // Protocol Ping/Pong never lands here — without this, a quiet-but-TCP-up
      // socket leaves optimistic running chrome stuck on Mobile / Web.
      noteActivity()
      if (typeof event.data === 'string' && event.data.startsWith(WS_APP_KEEPALIVE_PREFIX)) {
        return
      }
      let full: ServerRequest
      let frame: F
      try {
        if (typeof event.data !== 'string') throw new Error('binary WebSocket frame')
        full = serverRequestSchema.parse(JSON.parse(event.data))
        frame = frameSchema.parse(full.payload)
      } catch (error) {
        console.error(`[client-connection] dropping malformed WebSocket frame on ${path}:`, error)
        return
      }
      this.onEnvelope(full)
      enqueue({ kind: 'frame', envelope: { rpcId: full.rpcId, payload: frame } })
    }
    const handleClose = (): void => { enqueue({ kind: 'end' }) }
    const handleAbort = (): void => {
      if (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN) socket.close()
    }
    socket.addEventListener('open', handleOpen)
    socket.addEventListener('message', handleMessage)
    socket.addEventListener('close', handleClose, { once: true })
    signal.addEventListener('abort', handleAbort, { once: true })
    if (signal.aborted) handleAbort()
    try {
      while (true) {
        while (inbox.length > 0) {
          const item = inbox.shift() as SocketItem<F>
          if (item.kind === 'end') return
          yield item.envelope
        }
        if (idleError !== undefined) throw idleError
        await new Promise<void>((resolve) => { wake = resolve })
        if (idleError !== undefined) throw idleError
      }
    } finally {
      clearIdle()
      signal.removeEventListener('abort', handleAbort)
      socket.removeEventListener('open', handleOpen)
      socket.removeEventListener('message', handleMessage)
      socket.removeEventListener('close', handleClose)
      handleAbort()
    }
  }
}
