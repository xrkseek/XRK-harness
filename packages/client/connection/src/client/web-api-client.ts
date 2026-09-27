/** Browser API carrier: HTTP upstream plus WebSocket (or SSE on `xrk-app://`) downlinks. */

import type { ApiProxy, HostFrame, MuxFrame, RpcRequest, ServerRequest } from './api.ts'
import { AbstractApiClient } from './api.ts'
import { hostFrameSchema, muxFrameSchema } from '@xrkseek/xrk-host-apiproxy/api/events.schema'
import { serverRequestSchema } from '@xrkseek/xrk-host-apiproxy/api/rpc.schema'
import { HOST_EVENTS_PATH, MUX_EVENTS_PATH } from '../api-path.ts'

type SocketItem<F> = { kind: 'frame'; envelope: RpcRequest<F> } | { kind: 'end' }
type Parser<F> = { parse(value: unknown): F }

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
      // Electron custom-protocol origins allow very few concurrent fetches.
      // Two long-lived SSE streams (mux+host) starve unary `host.describe`
      // and freeze the UI on 「连接中」. Mux alone carries session traffic;
      // host-bus frames (`host/session-status`, …) are unavailable here —
      // Session arms/clears `running` from turn/start|end + prompt optimism.
      return this.openPlaceholderDownlink(signal, onOpen)
    }
    return this.readWebSocket(HOST_EVENTS_PATH, signal, hostFrameSchema, onOpen)
  }

  /**
   * Satisfies the connection handshake's host-stream onOpen without a second
   * long-lived custom-protocol fetch (see {@link openHost}).
   */
  private async *openPlaceholderDownlink(
    signal: AbortSignal,
    onOpen?: () => void,
  ): AsyncGenerator<RpcRequest<HostFrame>> {
    onOpen?.()
    if (signal.aborted) return
    await new Promise<void>((resolve) => {
      signal.addEventListener('abort', () => resolve(), { once: true })
    })
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
    const enqueue = (item: SocketItem<F>): void => {
      inbox.push(item)
      wake?.()
      wake = undefined
    }
    const handleOpen = (): void => { onOpen?.() }
    const handleMessage = (event: MessageEvent): void => {
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
        await new Promise<void>((resolve) => { wake = resolve })
      }
    } finally {
      signal.removeEventListener('abort', handleAbort)
      socket.removeEventListener('open', handleOpen)
      socket.removeEventListener('message', handleMessage)
      socket.removeEventListener('close', handleClose)
      handleAbort()
    }
  }
}
