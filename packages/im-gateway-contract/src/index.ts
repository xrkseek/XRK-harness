/**
 * Host ↔ IM gateway sidecar wire (ADR-0006).
 * Sidecar authors implement health + push to Host relay.
 * This is NOT a Telegram/Discord/Slack/… SDK matrix.
 */

import { timingSafeEqual } from "node:crypto";

/** Bump when relay/health shapes break sidecar authors. */
export const IM_GATEWAY_CONTRACT_VERSION = "1" as const;

export const IM_GATEWAY_ENV_URL = "XRK_IM_GATEWAY_URL";
export const IM_GATEWAY_ENV_TOKEN = "XRK_IM_GATEWAY_TOKEN";
/** Optional alias for channel webhook / send / stream (same trust as gateway token). */
export const IM_GATEWAY_ENV_WEBHOOK_TOKEN = "XRK_IM_WEBHOOK_TOKEN";

/** Host paths the sidecar must know (relative to Host base URL). */
export const IM_GATEWAY_HOST_RELAY_PATH = "/api/im/gateway/relay";
export const IM_GATEWAY_HOST_HEALTH_PATH = "/api/im/gateway/health";
/** Sidecar must expose this under its own base URL. */
export const IM_GATEWAY_SIDECAR_HEALTH_PATH = "/health";

export type ImGatewayState =
  | "bridge"
  | "sidecar-configured"
  | "sidecar-reachable"
  | "sidecar-unreachable";

export interface ImGatewaySidecarConfig {
  readonly url: string;
  readonly token?: string;
}

/** Body Host accepts on POST /api/im/gateway/relay. */
export interface ImGatewayRelayInbound {
  /** Vendor / Face channel id (e.g. weixin, telegram, mock). */
  readonly channel: string;
  readonly botId?: string;
  /** Preferred message text; Host falls back to JSON slice of the body. */
  readonly text?: string;
  /**
   * Optional media (image|video|file|audio). Host normalizes onto the message
   * row; Face admit maps to ContentBlocks / model-only handles. Still contract v1.
   */
  readonly attachments?: readonly Record<string, unknown>[];
  /** Opaque vendor payload kept on the message row as `raw`. */
  readonly [key: string]: unknown;
}

export interface ImGatewayHealthBody {
  readonly ok: boolean;
  readonly status?: string;
  readonly contractVersion?: string;
}

export interface ImGatewayProbeResult {
  readonly ok: boolean;
  readonly status?: string;
  readonly error?: string;
  readonly contractVersion?: string;
}

export type ImGatewayRelayAuthDecision =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code: "gateway-relay-unauthorized";
      readonly message: string;
    };

export type ImGatewayRelayParseResult =
  | { readonly ok: true; readonly body: ImGatewayRelayInbound }
  | {
      readonly ok: false;
      readonly code: "channel-required" | "invalid-json";
      readonly message: string;
    };

/** Read `XRK_IM_GATEWAY_URL` (+ optional token). */
export function readImGatewaySidecarConfig(
  env: NodeJS.ProcessEnv = process.env,
): ImGatewaySidecarConfig | undefined {
  const url = env[IM_GATEWAY_ENV_URL]?.trim();
  if (!url) return undefined;
  const token = env[IM_GATEWAY_ENV_TOKEN]?.trim();
  return token ? { url, token } : { url };
}

/** True when the TCP peer is loopback (never trust spoofable `Host`). */
export function isLoopbackRemoteAddress(
  remoteAddress: string | undefined,
): boolean {
  if (!remoteAddress) return false;
  const a = remoteAddress.trim().toLowerCase();
  return (
    a === "127.0.0.1" ||
    a === "::1" ||
    a === "::ffff:127.0.0.1" ||
    a === "localhost"
  );
}

/** Constant-time string equality; length mismatch → false (no throw). */
export function timingSafeTokenEqual(
  left: string | undefined,
  right: string | undefined,
): boolean {
  if (left === undefined || right === undefined) return false;
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function bearerOf(authorization: string | undefined): string {
  const auth = String(authorization ?? "");
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
}

/**
 * Authorize a Host relay POST.
 * With token: Bearer or `x-im-gateway-token` must match (constant-time).
 * Without token: only **TCP loopback** peers (`remoteAddress`) — never `Host`.
 */
export function assertRelayAuthorized(input: {
  /**
   * @deprecated Spoofable. Ignored when `remoteAddress` is provided; kept so
   * older call sites compile while they migrate.
   */
  readonly hostHeader?: string | undefined;
  /** TCP peer from `req.socket.remoteAddress` — required for loopback gate. */
  readonly remoteAddress?: string | undefined;
  readonly authorization: string | undefined;
  readonly gatewayTokenHeader: string | undefined;
  readonly config: ImGatewaySidecarConfig | undefined;
}): ImGatewayRelayAuthDecision {
  const config = input.config;
  if (!config?.token) {
    if (isLoopbackRemoteAddress(input.remoteAddress)) {
      return { ok: true };
    }
    return {
      ok: false,
      code: "gateway-relay-unauthorized",
      message:
        "Set XRK_IM_GATEWAY_TOKEN or relay from a loopback TCP peer (Host header is not trusted).",
    };
  }
  const bearer = bearerOf(input.authorization);
  const headerToken = String(input.gatewayTokenHeader ?? "");
  if (
    timingSafeTokenEqual(bearer, config.token) ||
    timingSafeTokenEqual(headerToken, config.token)
  ) {
    return { ok: true };
  }
  return {
    ok: false,
    code: "gateway-relay-unauthorized",
    message: "Set XRK_IM_GATEWAY_TOKEN or relay from a loopback TCP peer.",
  };
}

export type ImPublicIngressAuthDecision =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code: "im-ingress-unauthorized";
      readonly message: string;
    };

/**
 * Authorize public IM ingress that sits on `tryHandlePublic` (before API key):
 * webhook / send / messages / stream.
 * Loopback TCP → allow. Else require `XRK_IM_GATEWAY_TOKEN` or
 * `XRK_IM_WEBHOOK_TOKEN` (Bearer / `x-im-gateway-token`), or `XRK_API_KEY`
 * (Bearer / `x-api-key`).
 */
export function assertImPublicIngressAuthorized(input: {
  readonly remoteAddress: string | undefined;
  readonly authorization: string | undefined;
  readonly gatewayTokenHeader: string | undefined;
  readonly apiKeyHeader: string | undefined;
  readonly env?: NodeJS.ProcessEnv;
}): ImPublicIngressAuthDecision {
  if (isLoopbackRemoteAddress(input.remoteAddress)) {
    return { ok: true };
  }
  const env = input.env ?? process.env;
  const imToken =
    env[IM_GATEWAY_ENV_TOKEN]?.trim() ||
    env[IM_GATEWAY_ENV_WEBHOOK_TOKEN]?.trim() ||
    "";
  const bearer = bearerOf(input.authorization);
  const gatewayHeader = String(input.gatewayTokenHeader ?? "");
  if (
    imToken &&
    (timingSafeTokenEqual(bearer, imToken) ||
      timingSafeTokenEqual(gatewayHeader, imToken))
  ) {
    return { ok: true };
  }
  const apiKey = env.XRK_API_KEY?.trim() || "";
  const apiHeader = String(input.apiKeyHeader ?? "");
  if (
    apiKey &&
    (timingSafeTokenEqual(bearer, apiKey) ||
      timingSafeTokenEqual(apiHeader, apiKey))
  ) {
    return { ok: true };
  }
  return {
    ok: false,
    code: "im-ingress-unauthorized",
    message:
      "Non-loopback IM ingress requires XRK_IM_GATEWAY_TOKEN (or XRK_IM_WEBHOOK_TOKEN) or XRK_API_KEY.",
  };
}

/** Parse + validate a relay JSON object (already decoded). */
export function parseRelayBody(raw: unknown): ImGatewayRelayParseResult {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      ok: false,
      code: "invalid-json",
      message: "relay body must be a JSON object",
    };
  }
  const record = raw as Record<string, unknown>;
  const channel =
    typeof record.channel === "string" ? record.channel.trim() : "";
  if (!channel) {
    return {
      ok: false,
      code: "channel-required",
      message: "channel is required",
    };
  }
  const botId =
    typeof record.botId === "string" && record.botId.trim()
      ? record.botId.trim()
      : undefined;
  const text =
    typeof record.text === "string" ? record.text : undefined;
  return {
    ok: true,
    body: {
      ...record,
      channel,
      ...(botId !== undefined ? { botId } : {}),
      ...(text !== undefined ? { text } : {}),
    },
  };
}

/** Normalize a sidecar `/health` JSON body into a probe result. */
export function interpretSidecarHealthBody(
  body: unknown,
  httpOk: boolean,
): ImGatewayProbeResult {
  if (!httpOk) {
    return { ok: false, error: "upstream not ok" };
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "health body must be a JSON object" };
  }
  const record = body as Record<string, unknown>;
  const status =
    typeof record.status === "string" ? record.status : undefined;
  const contractVersion =
    typeof record.contractVersion === "string"
      ? record.contractVersion
      : undefined;
  return {
    ok: record.ok !== false,
    ...(status ? { status } : { status: "ok" }),
    ...(contractVersion ? { contractVersion } : {}),
  };
}

/** Derive Face/status `state` from config + optional probe. */
export function imGatewayStateFromProbe(
  config: ImGatewaySidecarConfig | undefined,
  probe?: ImGatewayProbeResult,
): ImGatewayState {
  if (!config) return "bridge";
  if (!probe) return "sidecar-configured";
  return probe.ok ? "sidecar-reachable" : "sidecar-unreachable";
}

/** Host-local push path (no external sidecar required). */
export const IM_GATEWAY_HOST_LOCAL_WS_PATH = "/api/im/gateway/ws";

/** Build the canonical sidecar `/health` response body. */
export function sidecarHealthResponse(status = "ok"): ImGatewayHealthBody {
  return {
    ok: true,
    status,
    contractVersion: IM_GATEWAY_CONTRACT_VERSION,
  };
}

/**
 * GET `{url}/health` on an external sidecar (doctor / Host boot).
 * Does not embed vendor SDKs — only the ADR-0006 health probe.
 */
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
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      return { ok: false, error: `upstream ${res.status}` };
    }
    return interpretSidecarHealthBody(body, true);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
