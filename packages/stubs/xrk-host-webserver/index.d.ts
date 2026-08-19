/**
 * Browser HTTP carrier types: route registries consumed by client-connection
 * host emit. The live listen loop lives in Host compose; this stub only
 * supplies the Context merge and route shapes.
 *
 * @module @xrkseek/xrk-host-webserver
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'

/** Route match kind: 'exact' matches the pathname verbatim; 'prefix' matches path and path/<anything>. */
export type WebRouteKind = 'exact' | 'prefix'

/** One named route registration. */
export interface WebRoute {
  kind: WebRouteKind
  /** Absolute pathname, no trailing slash. */
  path: string
  /** Owns the full response lifecycle (may hold the response open, e.g. SSE). */
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
}

/** One exact-path HTTP upgrade registration. */
export interface WebUpgradeRoute {
  /** Absolute pathname, no trailing slash. */
  path: string
  /** Owns protocol negotiation and the upgraded socket after dispatch. */
  handler: (req: IncomingMessage, socket: Duplex, head: Buffer) => void | Promise<void>
}

/** Minimal webServer face the connection host plugin injects. */
export interface WebServer {
  /** The listening port (OS-assigned when config.port is 0). */
  readonly port: number
  /** The configured bind host. */
  readonly host: '127.0.0.1' | '0.0.0.0'
  /** Register a named HTTP route; returns the disposer. */
  register(route: WebRoute): () => void
  /** Register an exact-path upgrade route; returns the disposer. */
  registerUpgrade(route: WebUpgradeRoute): () => void
}

declare module '@xrkseek/cordis' {
  interface Context {
    webServer: WebServer
  }
}
