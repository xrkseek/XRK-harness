/**
 * Optional IM long-lived gateway sidecar (ADR-0006 D-2).
 * Host stays TypeScript; vendor WS client runs out-of-process and relays inbound here.
 * Wire shapes live in `@xrkseek/im-gateway-contract` (not a vendor SDK matrix).
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  IM_GATEWAY_ENV_TOKEN,
  IM_GATEWAY_ENV_URL,
  IM_GATEWAY_HOST_HEALTH_PATH,
  IM_GATEWAY_HOST_RELAY_PATH,
  IM_GATEWAY_SIDECAR_HEALTH_PATH,
  assertRelayAuthorized,
  imGatewayStateFromProbe,
  interpretSidecarHealthBody,
  parseRelayBody,
  readImGatewaySidecarConfig,
  type ImGatewayProbeResult,
  type ImGatewaySidecarConfig,
} from "@xrkseek/im-gateway-contract";
import { ingestImWebhook } from "./im-messaging-bridge.js";
import { adapterEcho } from "./honest-envelope.js";
import { IM_GATEWAY_LOCAL_WS_PATH } from "./im-gateway-local-ws.js";
import { sendJson } from "./underlying/http-json.js";
import { parseJsonBody } from "./underlying/http-kit.js";

export {
  IM_GATEWAY_ENV_TOKEN,
  IM_GATEWAY_ENV_URL,
  readImGatewaySidecarConfig,
  type ImGatewaySidecarConfig,
};

export async function probeImGatewaySidecar(
  config: ImGatewaySidecarConfig,
  timeoutMs = 3000,
): Promise<ImGatewayProbeResult> {
  const base = config.url.replace(/\/+$/, "");
  const headers: Record<string, string> = { accept: "application/json" };
  if (config.token) headers.authorization = `Bearer ${config.token}`;
  try {
    const res = await fetch(`${base}${IM_GATEWAY_SIDECAR_HEALTH_PATH}`, {
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = (await res.json().catch(() => null));
    if (!res.ok) {
      return {
        ok: false,
        error: `upstream ${res.status}`,
      };
    }
    return interpretSidecarHealthBody(body, true);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function imGatewaySidecarStatusPayload(
  channel: string,
  config: ImGatewaySidecarConfig | undefined,
  probe?: ImGatewayProbeResult,
): Record<string, unknown> {
  const state = imGatewayStateFromProbe(config, probe);
  if (!config) {
    return {
      ok: true,
      channel,
      state,
      transport: "host-ingress",
      sidecar: null,
      localWsPath: IM_GATEWAY_LOCAL_WS_PATH,
      relayPath: IM_GATEWAY_HOST_RELAY_PATH,
      healthPath: IM_GATEWAY_HOST_HEALTH_PATH,
      env: [IM_GATEWAY_ENV_URL, IM_GATEWAY_ENV_TOKEN],
      note: "No external gateway env. Local WS and relay accept push; webhook/poll stay available. Vendor SDKs are not bundled.",
      adr: "docs/adr/0006-im-long-lived-gateway.md",
      contract: "@xrkseek/im-gateway-contract",
      ...adapterEcho(),
    };
  }
  const reachable = probe?.ok === true;
  return {
    ok: true,
    channel,
    state,
    transport: "external-sidecar",
    sidecar: {
      url: config.url,
      probed: !!probe,
      reachable,
      ...(probe?.status ? { upstreamStatus: probe.status } : {}),
      ...(probe?.contractVersion
        ? { contractVersion: probe.contractVersion }
        : {}),
      ...(probe?.error ? { probeError: probe.error } : {}),
    },
    relayPath: IM_GATEWAY_HOST_RELAY_PATH,
    healthPath: IM_GATEWAY_HOST_HEALTH_PATH,
    localWsPath: IM_GATEWAY_LOCAL_WS_PATH,
    env: [IM_GATEWAY_ENV_URL, IM_GATEWAY_ENV_TOKEN],
    note: reachable
      ? "Sidecar reachable; push vendor events to relayPath with gateway token."
      : "Sidecar URL configured; start relay and set XRK_IM_GATEWAY_TOKEN for non-local relay.",
    adr: "docs/adr/0006-im-long-lived-gateway.md",
    contract: "@xrkseek/im-gateway-contract",
    ...adapterEcho(),
  };
}

export async function handleImGatewaySidecarHttp(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  xrkHome: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  const config = readImGatewaySidecarConfig(env);
  const method = (req.method ?? "GET").toUpperCase();

  if (
    pathname === IM_GATEWAY_HOST_HEALTH_PATH &&
    (method === "GET" || method === "HEAD")
  ) {
    const probe = config ? await probeImGatewaySidecar(config) : undefined;
    sendJson(res, 200, {
      ok: true,
      configured: !!config,
      localWsPath: IM_GATEWAY_LOCAL_WS_PATH,
      probe,
      relayPath: IM_GATEWAY_HOST_RELAY_PATH,
      env: [IM_GATEWAY_ENV_URL, IM_GATEWAY_ENV_TOKEN],
      adapter: "xrk-dsh-compat",
      contract: "@xrkseek/im-gateway-contract",
      note: config
        ? "External sidecar configured. Local WS ingress stays available."
        : "Local WS ingress is up without XRK_IM_GATEWAY_*.",
    });
    return true;
  }

  if (pathname === IM_GATEWAY_HOST_RELAY_PATH && method === "POST") {
    const auth = assertRelayAuthorized({
      hostHeader:
        typeof req.headers.host === "string" ? req.headers.host : undefined,
      authorization:
        typeof req.headers.authorization === "string"
          ? req.headers.authorization
          : undefined,
      gatewayTokenHeader:
        typeof req.headers["x-im-gateway-token"] === "string"
          ? req.headers["x-im-gateway-token"]
          : undefined,
      config,
    });
    if (!auth.ok) {
      sendJson(res, 401, {
        ok: false,
        code: auth.code,
        message: auth.message,
      });
      return true;
    }
    const raw = await parseJsonBody(req);
    const parsed = parseRelayBody(raw);
    if (!parsed.ok) {
      sendJson(res, 400, {
        ok: false,
        code: parsed.code,
        message: parsed.message,
      });
      return true;
    }
    const { channel, botId, ...rest } = parsed.body;
    const row = ingestImWebhook(
      xrkHome,
      channel,
      { ...rest, channel, ...(botId ? { botId } : {}) },
      botId,
    );
    sendJson(res, 200, {
      ok: true,
      received: true,
      messageId: row.id,
      channel,
      mode: "sidecar-relay",
      adapter: "xrk-dsh-compat",
      contract: "@xrkseek/im-gateway-contract",
    });
    return true;
  }

  return false;
}
