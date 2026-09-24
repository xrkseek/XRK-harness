import { createMemorySessionTelemetrySink } from "./memory.js";
import {
  createOtlpHttpSessionTelemetrySink,
  resolveOtlpLogsEndpoint,
  type OtlpFetch,
} from "./otlp-http.js";
import type { SessionTelemetrySink } from "./types.js";

export {
  SessionTelemetryError,
  type SessionTelemetryChannel,
  type SessionTelemetryRecord,
  type SessionTelemetrySeverity,
  type SessionTelemetrySink,
} from "./types.js";
export {
  opsRecord,
  recordFromSessionEvent,
} from "./record.js";
export {
  createMemorySessionTelemetrySink,
  type MemorySessionTelemetryOptions,
} from "./memory.js";
export {
  createOtlpHttpSessionTelemetrySink,
  resolveOtlpLogsEndpoint,
  type OtlpFetch,
  type OtlpHttpSessionTelemetryOptions,
} from "./otlp-http.js";
export {
  wrapStoreForSessionTelemetry,
  type WrapStoreForSessionTelemetryOptions,
} from "./wrap-store.js";

/** Face `session-telemetry` product shape (Settings SoT). */
export type SessionTelemetryMode = "off" | "memory" | "otlp";

export interface SessionTelemetryProductConfig {
  readonly mode: SessionTelemetryMode;
  /** Required for `otlp` unless an OTEL_* / XRK_TELEMETRY_OTLP_ENDPOINT is set. */
  readonly endpoint?: string;
}

export interface DefaultSessionTelemetryAccessOptions {
  readonly env?: NodeJS.ProcessEnv;
  /**
   * Face Settings product config. Used when `XRK_TELEMETRY` is unset
   * (env remains the CI bypass).
   */
  readonly product?: SessionTelemetryProductConfig;
  readonly sink?: SessionTelemetrySink;
  readonly fetchImpl?: OtlpFetch;
  readonly serviceName?: string;
}

export interface DefaultSessionTelemetryAccess {
  readonly sink?: SessionTelemetrySink;
  readonly unavailableMessage: string;
}

/** Parse a Face `session-telemetry` namespace value (unknown → product or undefined). */
export function parseSessionTelemetryProduct(
  raw: unknown,
): SessionTelemetryProductConfig | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const row = raw as Record<string, unknown>;
  const modeRaw = typeof row.mode === "string" ? row.mode.trim().toLowerCase() : "";
  const mode: SessionTelemetryMode =
    modeRaw === "memory" || modeRaw === "otlp" || modeRaw === "off"
      ? modeRaw
      : "off";
  const endpoint =
    typeof row.endpoint === "string" && row.endpoint.trim()
      ? row.endpoint.trim()
      : undefined;
  return {
    mode,
    ...(endpoint ? { endpoint } : {}),
  };
}

export function sessionTelemetryUnavailableMessage(
  env: NodeJS.ProcessEnv = process.env,
  product?: SessionTelemetryProductConfig,
): string {
  const flag = String(env.XRK_TELEMETRY ?? "").trim().toLowerCase();
  if (flag === "0" || flag === "off" || flag === "disabled") {
    return "Session telemetry disabled (XRK_TELEMETRY=0).";
  }
  if (flag === "memory") {
    return "Session telemetry memory sink.";
  }
  if (flag === "1" || flag === "otlp" || flag === "otel") {
    return (
      "XRK_TELEMETRY=1 but no OTLP endpoint. Set XRK_TELEMETRY_OTLP_ENDPOINT " +
      "or OTEL_EXPORTER_OTLP_LOGS_ENDPOINT / OTEL_EXPORTER_OTLP_ENDPOINT."
    );
  }
  if (flag === "" && product) {
    if (product.mode === "off") {
      return "Session telemetry disabled (Settings → session-telemetry mode=off).";
    }
    if (product.mode === "memory") {
      return "Session telemetry memory sink (Settings).";
    }
    return (
      "Session telemetry OTLP (Settings) but no endpoint. Set endpoint in " +
      "Settings or XRK_TELEMETRY_OTLP_ENDPOINT / OTEL_*."
    );
  }
  return (
    "Session telemetry is off. Set Settings → session-telemetry, or " +
    "XRK_TELEMETRY=memory / XRK_TELEMETRY=1 with an OTLP logs endpoint. " +
    "See docs/session-telemetry.md."
  );
}

function otlpHeadersFromEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const headersRaw = String(env.OTEL_EXPORTER_OTLP_HEADERS ?? "").trim();
  const headers: Record<string, string> = {};
  if (!headersRaw) return headers;
  for (const part of headersRaw.split(",")) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    headers[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  }
  return headers;
}

function buildOtlpSink(
  endpoint: string,
  options: DefaultSessionTelemetryAccessOptions,
  env: NodeJS.ProcessEnv,
): SessionTelemetrySink {
  const headers = otlpHeadersFromEnv(env);
  return createOtlpHttpSessionTelemetrySink({
    endpoint,
    ...(Object.keys(headers).length ? { headers } : {}),
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    ...(options.serviceName ? { serviceName: options.serviceName } : {}),
  });
}

/**
 * Resolve a session-telemetry sink.
 * - Injected `sink` wins.
 * - Non-empty `XRK_TELEMETRY` → env path (CI bypass over Settings).
 * - Else Face `product` (`off` / `memory` / `otlp` + endpoint).
 * - Else if a standard OTEL_* endpoint is set → OTLP (opt-in via endpoint alone).
 * - Else disabled.
 */
export function createDefaultSessionTelemetryAccess(
  options: DefaultSessionTelemetryAccessOptions = {},
): DefaultSessionTelemetryAccess {
  const env = options.env ?? process.env;
  const product = options.product;
  const unavailableMessage = sessionTelemetryUnavailableMessage(env, product);
  if (options.sink) {
    return { sink: options.sink, unavailableMessage };
  }
  const flag = String(env.XRK_TELEMETRY ?? "").trim().toLowerCase();

  // CI / shell bypass: any explicit XRK_TELEMETRY wins over Face Settings.
  if (flag !== "") {
    if (flag === "0" || flag === "off" || flag === "disabled") {
      return { unavailableMessage };
    }
    if (flag === "memory") {
      return {
        sink: createMemorySessionTelemetrySink(),
        unavailableMessage,
      };
    }
    const endpoint = resolveOtlpLogsEndpoint(env);
    const wantOtlp =
      flag === "1" || flag === "otlp" || flag === "otel";
    if (wantOtlp) {
      if (!endpoint) return { unavailableMessage };
      return {
        sink: buildOtlpSink(endpoint, options, env),
        unavailableMessage,
      };
    }
    return { unavailableMessage };
  }

  // Product Settings (Face `session-telemetry`).
  if (product) {
    if (product.mode === "off") {
      return { unavailableMessage };
    }
    if (product.mode === "memory") {
      return {
        sink: createMemorySessionTelemetrySink(),
        unavailableMessage,
      };
    }
    const endpoint =
      product.endpoint?.trim() || resolveOtlpLogsEndpoint(env) || undefined;
    if (!endpoint) return { unavailableMessage };
    return {
      sink: buildOtlpSink(endpoint, options, env),
      unavailableMessage,
    };
  }

  // Legacy: OTEL endpoint alone still opt-in when no Face product was passed.
  const endpoint = resolveOtlpLogsEndpoint(env);
  if (endpoint) {
    return {
      sink: buildOtlpSink(endpoint, options, env),
      unavailableMessage,
    };
  }
  return { unavailableMessage };
}
