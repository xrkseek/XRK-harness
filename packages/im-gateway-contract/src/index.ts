/**
 * Host ↔ IM gateway sidecar wire (ADR-0006).
 * Sidecar authors implement health + push to Host relay.
 * This is NOT a Telegram/Discord/Slack/… SDK matrix.
 */

/** Bump when relay/health shapes break sidecar authors. */
export const IM_GATEWAY_CONTRACT_VERSION = "1" as const;

export const IM_GATEWAY_ENV_URL = "XRK_IM_GATEWAY_URL";
export const IM_GATEWAY_ENV_TOKEN = "XRK_IM_GATEWAY_TOKEN";

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

/**
 * Authorize a Host relay POST.
 * With token: Bearer or `x-im-gateway-token` must match.
 * Without token: only loopback Host (127.0.0.1 / localhost).
 */
export function assertRelayAuthorized(input: {
  readonly hostHeader: string | undefined;
  readonly authorization: string | undefined;
  readonly gatewayTokenHeader: string | undefined;
  readonly config: ImGatewaySidecarConfig | undefined;
}): ImGatewayRelayAuthDecision {
  const config = input.config;
  if (!config?.token) {
    const host = String(input.hostHeader ?? "");
    if (/^(127\.0\.0\.1|localhost)(:\d+)?$/i.test(host)) {
      return { ok: true };
    }
    return {
      ok: false,
      code: "gateway-relay-unauthorized",
      message: "Set XRK_IM_GATEWAY_TOKEN or relay from localhost.",
    };
  }
  const auth = String(input.authorization ?? "");
  const headerToken = String(input.gatewayTokenHeader ?? "");
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (bearer === config.token || headerToken === config.token) {
    return { ok: true };
  }
  return {
    ok: false,
    code: "gateway-relay-unauthorized",
    message: "Set XRK_IM_GATEWAY_TOKEN or relay from localhost.",
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

/** Build the canonical sidecar `/health` response body. */
export function sidecarHealthResponse(status = "ok"): ImGatewayHealthBody {
  return {
    ok: true,
    status,
    contractVersion: IM_GATEWAY_CONTRACT_VERSION,
  };
}
