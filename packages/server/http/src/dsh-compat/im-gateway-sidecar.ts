/**
 * Optional IM long-lived gateway sidecar (ADR-0006 D-2).
 * Host stays TypeScript; vendor WS client runs out-of-process and relays inbound here.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { ingestImWebhook } from "./im-messaging-bridge.js";
import { adapterEcho } from "./honest-envelope.js";
import { sendJson } from "./underlying/http-json.js";
import { parseJsonBody } from "./underlying/http-kit.js";

export const IM_GATEWAY_ENV_URL = "XRK_IM_GATEWAY_URL";
export const IM_GATEWAY_ENV_TOKEN = "XRK_IM_GATEWAY_TOKEN";

export interface ImGatewaySidecarConfig {
  readonly url: string;
  readonly token?: string;
}

export function readImGatewaySidecarConfig(
  env: NodeJS.ProcessEnv = process.env,
): ImGatewaySidecarConfig | undefined {
  const url = env[IM_GATEWAY_ENV_URL]?.trim();
  if (!url) return undefined;
  const token = env[IM_GATEWAY_ENV_TOKEN]?.trim();
  return token ? { url, token } : { url };
}

export async function probeImGatewaySidecar(
  config: ImGatewaySidecarConfig,
  timeoutMs = 3000,
): Promise<{ ok: boolean; status?: string; error?: string }> {
  const base = config.url.replace(/\/+$/, "");
  const headers: Record<string, string> = { accept: "application/json" };
  if (config.token) headers.authorization = `Bearer ${config.token}`;
  try {
    const res = await fetch(`${base}/health`, {
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      return { ok: false, error: `upstream ${res.status}` };
    }
    const body = (await res.json()) as { status?: string; ok?: boolean };
    return {
      ok: body.ok !== false,
      status: typeof body.status === "string" ? body.status : "ok",
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function relayAuthorized(
  req: IncomingMessage,
  config: ImGatewaySidecarConfig | undefined,
): boolean {
  if (!config?.token) {
    const host = String(req.headers.host ?? "");
    return /^(127\.0\.0\.1|localhost)(:\d+)?$/i.test(host);
  }
  const auth = String(req.headers.authorization ?? "");
  const headerToken = String(req.headers["x-im-gateway-token"] ?? "");
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  return bearer === config.token || headerToken === config.token;
}

export function imGatewaySidecarStatusPayload(
  channel: string,
  config: ImGatewaySidecarConfig | undefined,
  probe?: { ok: boolean; status?: string; error?: string },
): Record<string, unknown> {
  if (!config) {
    return {
      ok: true,
      channel,
      state: "unavailable",
      transport: null,
      sidecar: null,
      relayPath: "/api/im/gateway/relay",
      env: [IM_GATEWAY_ENV_URL, IM_GATEWAY_ENV_TOKEN],
      adr: "docs/adr/0006-im-long-lived-gateway.md",
      ...adapterEcho(),
    };
  }
  const reachable = probe?.ok === true;
  const state = reachable
    ? "sidecar-reachable"
    : probe
      ? "sidecar-unreachable"
      : "sidecar-configured";
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
      ...(probe?.error ? { probeError: probe.error } : {}),
    },
    relayPath: "/api/im/gateway/relay",
    healthPath: "/api/im/gateway/health",
    env: [IM_GATEWAY_ENV_URL, IM_GATEWAY_ENV_TOKEN],
    note: reachable
      ? "Sidecar reachable; push vendor events to relayPath with gateway token."
      : "Sidecar URL configured; start relay and set XRK_IM_GATEWAY_TOKEN for non-local relay.",
    adr: "docs/adr/0006-im-long-lived-gateway.md",
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

  if (pathname === "/api/im/gateway/health" && (method === "GET" || method === "HEAD")) {
    const probe = config ? await probeImGatewaySidecar(config) : undefined;
    sendJson(res, 200, {
      ok: true,
      configured: !!config,
      probe,
      relayPath: "/api/im/gateway/relay",
      env: [IM_GATEWAY_ENV_URL, IM_GATEWAY_ENV_TOKEN],
      adapter: "xrk-dsh-compat",
    });
    return true;
  }

  if (pathname === "/api/im/gateway/relay" && method === "POST") {
    if (!relayAuthorized(req, config)) {
      sendJson(res, 401, {
        ok: false,
        code: "gateway-relay-unauthorized",
        message: "Set XRK_IM_GATEWAY_TOKEN or relay from localhost.",
      });
      return true;
    }
    const body = await parseJsonBody(req);
    const channel =
      typeof body.channel === "string" ? body.channel.trim() : "";
    if (!channel) {
      sendJson(res, 400, { ok: false, code: "channel-required" });
      return true;
    }
    const botId =
      typeof body.botId === "string" ? body.botId.trim() : undefined;
    const row = ingestImWebhook(xrkHome, channel, body, botId);
    sendJson(res, 200, {
      ok: true,
      received: true,
      messageId: row.id,
      channel,
      mode: "sidecar-relay",
      adapter: "xrk-dsh-compat",
    });
    return true;
  }

  return false;
}
