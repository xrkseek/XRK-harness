/**
 * Honest stub for cloud IM long-lived gateway (vendor push / persistent tunnel).
 * Short-request bridge: im-messaging-bridge.ts (webhook · poll · SSE snapshot).
 * Optional sidecar: im-gateway-sidecar.ts (XRK_IM_GATEWAY_* env).
 * In-process WS client: im-vendor-ws-client.ts (XRK_IM_GATEWAY_WS_URL or sidecar /ws).
 */
import { adapterEcho } from "./honest-envelope.js";
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

/** Vendor channel ids aligned with im-channels.ts. */
export const IM_GATEWAY_VENDORS = [
  "dingtalk",
  "feishu",
  "wecom",
  "qq",
  "telegram",
  "discord",
  "whatsapp",
  "slack",
  "weixin",
] as const;

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
    channel,
    state: wsUrl ? (ws.connected ? "ws-connected" : "ws-configured") : "bridge",
    transport: wsUrl ? "websocket-client" : "http-bridge",
    bridge: imLongLivedGatewayBridgePaths(channel),
    ws: wsUrl ? { url: wsUrl, ...ws } : null,
    vendors: [...IM_GATEWAY_VENDORS],
    adr: "docs/adr/0006-im-long-lived-gateway.md",
    note: wsUrl
      ? "Generic vendor WS client configured; webhook/poll bridge always available."
      : "Webhook/poll/SSE bridge active; set XRK_IM_GATEWAY_URL or XRK_IM_GATEWAY_WS_URL for long-lived push.",
    ...adapterEcho(),
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
        channel,
        mode: "sidecar",
        sidecarUrl: sidecar.url,
        relayPath: "/api/im/gateway/relay",
        healthPath: "/api/im/gateway/health",
        note: "Sidecar configured; vendor WS client runs out-of-process and relays inbound to Host.",
        bridgeAlternative: imLongLivedGatewayBridgePaths(channel),
        adr: "docs/adr/0006-im-long-lived-gateway.md",
        ...adapterEcho(),
      };
    }
    if (wsUrl) {
      const ws = startImVendorWsClient({ ...(xrkHome ? { xrkHome } : {}), env });
      return {
        ok: true,
        channel,
        mode: "ws-client",
        wsUrl,
        connected: ws.connected,
        reconnects: ws.reconnects,
        note: "Host WebSocket client started; inbound JSON { channel, ... } ingests via im-messaging bridge.",
        bridgeAlternative: imLongLivedGatewayBridgePaths(channel),
        adr: "docs/adr/0006-im-long-lived-gateway.md",
        ...adapterEcho(),
      };
    }
    return {
      ok: true,
      channel,
      mode: "bridge",
      bridge: imLongLivedGatewayBridgePaths(channel),
      note: "Long-lived push uses webhook/poll bridge until gateway env is configured.",
      adr: "docs/adr/0006-im-long-lived-gateway.md",
      ...adapterEcho(),
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
