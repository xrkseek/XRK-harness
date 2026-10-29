/** Host HTTP bridge for browser-client RPC. */
import type { Context } from '@xrkseek/cordis'
import z from '@xrkseek/schemastery'
import type {} from '@xrkseek/xrk-attachment'
// Activates the webServer Context merge used below.
import type { WebRoute, WebUpgradeRoute } from '@xrkseek/xrk-host-webserver'
import { toFetchHandler } from '@xrkseek/xrk-host-apiproxy'
import { API_PATH, HOST_EVENTS_PATH, MUX_EVENTS_PATH } from './api-path.ts'
import { bridge, DEFAULT_MAX_REQUEST_BODY_BYTES } from './http-bridge.ts'
import { assertTrustedAuthority, isTrustedApiRequest } from './api-request-trust.ts'
import { isPrivateLanHostname } from './loopback-hostname.ts'
import { apiKeyElevatesRequest } from './operator-elevation.ts'
import { HostConnectionService } from './rpc-host.ts'
import { rejectWebSocketUpgrade, WebSocketDownlinks } from './websocket-downlink.ts'

export type {
  ConnectionRpcAuthority,
  ConnectionRpcEndpointMatcher,
  ConnectionRpcHandler,
  ConnectionRpcHandlerOptions,
  HostConnectionHandle,
  HostConnectionRpc,
} from './rpc.ts'
export { HostConnectionService } from './rpc-host.ts'

export { API_PATH, HOST_EVENTS_PATH, MUX_EVENTS_PATH } from './api-path.ts'

/** Stable Cordis plugin name. */
export const name = 'client-connection'

/** Headroom for RPC JSON fields around aggregate base64 image payloads. */
const REQUEST_ENVELOPE_HEADROOM_BYTES = 1024 * 1024

function assertImageBodyCapacity(ctx: Context, maxRequestBodyBytes: number): void {
  const attachments = ctx.get('attachments')
  if (attachments === undefined) return
  const requiredImageBodyBytes = Math.ceil(
    attachments.imageLimits.maxMessageImageBytes * 4 / 3,
  ) + REQUEST_ENVELOPE_HEADROOM_BYTES
  if (maxRequestBodyBytes < requiredImageBodyBytes) {
    throw new Error(
      `client-connection maxRequestBodyBytes (${String(maxRequestBodyBytes)}) must be at least `
      + `${String(requiredImageBodyBytes)} for the configured aggregate image limit`,
    )
  }
}

/** Services required before providing Connection; API Proxy is an optional `/api` fallback. */
export const inject = ['webServer']

/** Plugin config: the deployment's non-loopback serving authorities. */
export interface ConnectionConfig {
  /**
   * Authorities this deployment serves beyond loopback: exact `host:port`, or
   * port-less `host` matching any port. The /api trust fence refuses any
   * request whose Host is neither loopback nor listed here, so a
   * non-loopback (`0.0.0.0`) deployment must declare the names it is reached
   * by (the dsh CLI derives the machine's LAN IP literals itself). An entry
   * that is not a bare, canonical authority fails the plugin load.
   */
  trustedHosts?: string[]
  /**
   * Bind LAN IP literals that may call privileged methods without a PIN
   * elevating the operator (同源 IP). DNS names never belong here.
   */
  privilegedHosts?: string[]
  /**
   * When true, a request that already cleared the outer trust fence may call
   * privileged methods (Host injects PIN / API-key elevation).
   */
  isOperatorElevated?: (request: Request) => boolean
  /** Maximum buffered JSON body for every `/api` request. */
  maxRequestBodyBytes?: number
}

export const Config: z<ConnectionConfig> = z.object({
  trustedHosts: z.array(String).default([]),
  privilegedHosts: z.array(String).default([]),
  maxRequestBodyBytes: z.natural().min(1).default(DEFAULT_MAX_REQUEST_BODY_BYTES),
})

/** Listen bind from Host (`XRK_SERVE_HOST`) when Cordis config omits privilegedHosts. */
function bindHostFromEnv(): string | undefined {
  const raw = typeof process !== 'undefined'
    ? process.env.XRK_SERVE_HOST?.trim().toLowerCase()
    : undefined
  if (!raw) return undefined
  if (!isPrivateLanHostname(raw)) return undefined
  return raw
}

/**
 * Methods gated to loopback / intentional private-LAN bind even on a
 * trusted-host (DNS) deployment. Native dialogs act on the host machine; the
 * settings and credential domains mutate the user's configuration and secret
 * store, and READING them is equally privileged — `settings.describe` returns
 * every exposed namespace's configuration and `credentials.describe` reports
 * whether an arbitrary environment-variable name is configured and where from.
 * `trustedHosts` DNS names remain a rebinding fence, not authentication — a
 * declared `harness.example` still cannot call these. Private IPv4 literals
 * (RFC1918) are allowed when the operator bound the Host there (`xrkh serve
 * --host 10.x`) and the browser is same-origin to that address: Origin /
 * sec-fetch-site still block cross-site callers. `llm.discoverModels` belongs
 * to this plane on both counts (draft credential + Host-side URL fetch).
 *
 * The model catalog (`llm.providers`, `llm.models`) is deliberately NOT here:
 * it carries provider ids, display names, and model lists — no endpoints,
 * keys, or key state — and a LAN client's model picker legitimately needs it.
 */
const PRIVILEGED_METHODS = new Set([
  // A preset composition names the plugins a session runs, so reading one is
  // reconnaissance; copy and remove rearrange what the deployment offers, and
  // openDocument drives the host desktop — all more than the roster beside
  // them. (Authoring is copy-only, so no method here accepts composition text
  // or a path; the pin is about who may manage the roster at all.)
  //
  // CHOOSING one is not pinned, and `agentPreset.list` is not either. Picking a
  // preset looks like escalation — one of them mounts the toolset that edits the
  // live runtime — but `session.create` already takes an `agentPreset`, so
  // pinning only the switch would leave the same capability one method over.
  // The deeper reason is that the capability is not the preset's to grant: the
  // deployment's own default already carries `bash` and the filesystem tools, so
  // any caller that may start a session at all can already run commands as this
  // process. Pinning the switch would be a fence beside an open gate.
  'agentPreset.read',
  'agentPreset.copy',
  'agentPreset.openDocument',
  'agentPreset.remove',
  'host.pickDirectory',
  'host.openPath',
  'host.listOpenInApps',
  'host.openInApp',
  'settings.describe',
  'settings.openDocument',
  'settings.update',
  'settings.replace',
  'settings.mutate',
  'credentials.describe',
  'credentials.set',
  'credentials.unset',
  'mcp.oauth.status',
  'mcp.oauth.login',
  'mcp.oauth.logout',
  'llm.discoverModels',
])

/**
 * Privileged plane: loopback always; bind LAN IPs in `privilegedHosts` with
 * same-origin markers; optional Host-injected operator elevation (PIN / key);
 * else `XRK_API_KEY` on the request. DNS `trustedHosts` alone never qualifies.
 */
function isPrivilegedApiRequest(
  request: Request,
  privilegedHosts: readonly string[],
  isOperatorElevated?: (request: Request) => boolean,
): boolean {
  if (isTrustedApiRequest(request, [])) return true
  if (isOperatorElevated?.(request) === true) return true
  if (apiKeyElevatesRequest(request)) return true
  if (privilegedHosts.length === 0) return false
  const host = request.headers.get('host')
  if (!host) return false
  let hostname: string
  try {
    hostname = new URL(`http://${host}`).hostname
  } catch {
    return false
  }
  if (!privilegedHosts.some((entry) => entry.toLowerCase() === hostname.toLowerCase())) {
    return false
  }
  return isTrustedApiRequest(request, [hostname])
}

/**
 * Mounts the API gateway under the browser transport prefix. Every request on
 * the prefix passes the browser-trust fence first (DNS-rebinding and
 * cross-site defense — [api-request-trust](./api-request-trust.ts));
 * privileged methods additionally require loopback, the bind LAN IP, or an
 * elevated operator (PIN / API key). DNS `trustedHosts` alone is not enough.
 * @param ctx - Host plugin context.
 * @param config - resolved plugin config (schema defaults applied).
 */
export function apply(ctx: Context, config?: ConnectionConfig): void {
  // The Loader resolves schema defaults; hand-built test contexts may pass none.
  const envBind = bindHostFromEnv()
  const privilegedHosts = [
    ...new Set([
      ...(config?.privilegedHosts ?? []),
      ...(envBind ? [envBind] : []),
    ].map((h) => h.toLowerCase())),
  ]
  const trustedHosts = [
    ...new Set([...(config?.trustedHosts ?? []), ...privilegedHosts]),
  ]
  const maxRequestBodyBytes = config?.maxRequestBodyBytes ?? DEFAULT_MAX_REQUEST_BODY_BYTES
  // Config boundary: a malformed entry fails the load loudly here rather than
  // silently authorizing its hostname prefix at request time.
  for (const entry of trustedHosts) assertTrustedAuthority(entry)
  if (ctx.get('apiProxy') !== undefined) assertImageBodyCapacity(ctx, maxRequestBodyBytes)
  const connection = new HostConnectionService(ctx, trustedHosts)
  const fetchHandler = connection.createSharedFetchHandler(API_PATH, {
    async fetch(request) {
      const pathname = new URL(request.url).pathname
      const method = pathname.startsWith(`${API_PATH}/`)
        ? pathname.slice(API_PATH.length + 1)
        : undefined
      if (method !== undefined
        && PRIVILEGED_METHODS.has(method)
        && !isPrivilegedApiRequest(request, privilegedHosts, config?.isOperatorElevated)) {
        return new Response('forbidden', { status: 403 })
      }
      if (request.method === 'GET' && (pathname === MUX_EVENTS_PATH || pathname === HOST_EVENTS_PATH)) {
        return new Response('upgrade required', {
          status: 426,
          headers: { connection: 'Upgrade', upgrade: 'websocket' },
        })
      }
      const apiProxy = ctx.get('apiProxy')
      if (apiProxy === undefined) return new Response('not found', { status: 404 })
      return toFetchHandler(apiProxy).fetch(request)
    },
  })
  const route: WebRoute = {
    kind: 'prefix',
    path: API_PATH,
    handler: async (req, res) => {
      if (!isTrustedApiRequest(req, trustedHosts)) {
        res.writeHead(403)
        res.end('forbidden')
        return
      }
      await bridge(req, res, fetchHandler, maxRequestBodyBytes)
    },
  }
  ctx.effect(() => ctx.webServer.register(route), 'client-connection: /api route')
  ctx.inject(['apiProxy'], (apiCtx) => {
    assertImageBodyCapacity(apiCtx, maxRequestBodyBytes)
    const downlinks = new WebSocketDownlinks(apiCtx.apiProxy)
    const registerDownlink = (
      path: string,
      handle: WebUpgradeRoute['handler'],
    ): void => {
      apiCtx.effect(() => apiCtx.webServer.registerUpgrade({
        path,
        handler: (req, socket, head) => {
          if (!isTrustedApiRequest(req, trustedHosts)) {
            rejectWebSocketUpgrade(socket)
            return
          }
          return handle(req, socket, head)
        },
      }), `client-connection: ${path} WebSocket`)
    }
    apiCtx.effect(() => () => downlinks.close(), 'client-connection: WebSocket downlinks')
    registerDownlink(MUX_EVENTS_PATH, (req, socket, head) => { downlinks.handleMux(req, socket, head) })
    registerDownlink(HOST_EVENTS_PATH, (req, socket, head) => { downlinks.handleHost(req, socket, head) })
  })
}
