/**
 * Cloud IM long-lived gateway status + connect RPC (ADR-0006).
 * Product path today: webhook/poll bridge always; optional sidecar / Host WS client.
 * Not a fake empty product — bridge paths are real; vendor cloud push needs env.
 */
import { adapterEcho } from "./honest-envelope.js";
import { IM_CHANNEL_NAMES } from "./im-vendors.js";
import {
  imGatewaySidecarStatusPayload,
  probeImGatewaySidecar,
  readImGatewaySidecarConfig,
} from "./im-gateway-sidecar.js";
import {
  getImVendorWsClientState,
  readImVendorWsUrl,
  startImVendorWsClient,
  stopImVendorWsClient,
} from "./im-vendor-ws-client.js";
import { IM_GATEWAY_LOCAL_WS_PATH } from "./im-gateway-local-ws.js";

/** @deprecated Prefer {@link IM_CHANNEL_NAMES} — kept for existing test imports. */
export const IM_GATEWAY_VENDORS = IM_CHANNEL_NAMES;

export function imLongLivedGatewayBridgePaths(
  channel: string,
): Record<string, string> {
  return {
    webhook: `/api/im/${channel}/webhook`,
    poll: `/api/im/${channel}/stream`,
    send: `/api/im/${channel}/send`,
    messages: `/api/im/${channel}/messages`,
    mode: "xrk-bridge",
  };
}

function gatewayMeta(channel: string): Record<string, unknown> {
  return {
    channel,
    vendors: [...IM_CHANNEL_NAMES],
    bridge: imLongLivedGatewayBridgePaths(channel),
    adr: "docs/adr/0006-im-long-lived-gateway.md",
    localWsPath: IM_GATEWAY_LOCAL_WS_PATH,
    ...adapterEcho(),
  };
}

export function imLongLivedGatewayStatus(
  channel: string,
  env: NodeJS.ProcessEnv = process.env,
): Record<string, unknown> {
  const sidecar = readImGatewaySidecarConfig(env);
  const wsUrl = readImVendorWsUrl(env);
  const ws = getImVendorWsClientState();
  if (sidecar) {
    return imGatewaySidecarStatusPayload(channel, sidecar);
  }
  return {
    ok: true,
    state: wsUrl ? (ws.connected ? "ws-connected" : "ws-configured") : "bridge",
    transport: wsUrl ? "websocket-client" : "http-bridge",
    ws: wsUrl ? { url: wsUrl, ...ws } : null,
    note: wsUrl
      ? "Generic vendor WS client configured; webhook/poll bridge always available."
      : "Webhook/poll/SSE bridge active. Local WS ingress is up without XRK_IM_GATEWAY_*; set that env only to dial an external vendor relay.",
    ...gatewayMeta(channel),
  };
}

export async function imLongLivedGatewayStatusAsync(
  channel: string,
  env: NodeJS.ProcessEnv = process.env,
  xrkHome?: string,
): Promise<Record<string, unknown>> {
  const sidecar = readImGatewaySidecarConfig(env);
  if (sidecar) {
    const probe = await probeImGatewaySidecar(sidecar);
    return imGatewaySidecarStatusPayload(channel, sidecar, probe);
  }
  const wsUrl = readImVendorWsUrl(env);
  if (wsUrl) {
    startImVendorWsClient({ ...(xrkHome ? { xrkHome } : {}), env });
  }
  return imLongLivedGatewayStatus(channel, env);
}

export function handleImLongLivedGatewayRpc(
  channel: string,
  endpoint: string,
  _payload: Record<string, unknown>,
  env: NodeJS.ProcessEnv = process.env,
  xrkHome?: string,
): Record<string, unknown> | null {
  if (
    endpoint === "connection.gateway.status" ||
    endpoint === "gateway.status" ||
    endpoint === "connection.gateway.describe"
  ) {
    return imLongLivedGatewayStatus(channel, env);
  }
  if (
    endpoint === "connection.gateway.connect" ||
    endpoint === "connection.gateway.start" ||
    endpoint === "connection.gateway.resume" ||
    endpoint === "gateway.connect"
  ) {
    const sidecar = readImGatewaySidecarConfig(env);
    const wsUrl = readImVendorWsUrl(env);
    if (sidecar) {
      return {
        ok: true,
        mode: "sidecar",
        sidecarUrl: sidecar.url,
        relayPath: "/api/im/gateway/relay",
        healthPath: "/api/im/gateway/health",
        note: "Sidecar configured; vendor WS client runs out-of-process and relays inbound to Host.",
        bridgeAlternative: imLongLivedGatewayBridgePaths(channel),
        ...gatewayMeta(channel),
      };
    }
    if (wsUrl) {
      const ws = startImVendorWsClient({ ...(xrkHome ? { xrkHome } : {}), env });
      return {
        ok: true,
        mode: "ws-client",
        wsUrl,
        connected: ws.connected,
        reconnects: ws.reconnects,
        note: "Host WebSocket client started; inbound JSON { channel, ... } ingests via im-messaging bridge.",
        bridgeAlternative: imLongLivedGatewayBridgePaths(channel),
        ...gatewayMeta(channel),
      };
    }
    return {
      ok: true,
      mode: "bridge",
      note: "Long-lived local ingress is /api/im/gateway/ws. External vendor dial waits for gateway env. Webhook/poll unchanged.",
      ...gatewayMeta(channel),
    };
  }
  if (
    endpoint === "connection.gateway.disconnect" ||
    endpoint === "gateway.disconnect"
  ) {
    stopImVendorWsClient();
    return {
      ok: true,
      channel,
      disconnected: true,
      mode: "bridge",
      note: "WebSocket client stopped; webhook/poll bridge remains available.",
    };
  }
  return null;
}
