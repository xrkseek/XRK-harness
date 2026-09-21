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

export interface DefaultSessionTelemetryAccessOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly sink?: SessionTelemetrySink;
  readonly fetchImpl?: OtlpFetch;
  readonly serviceName?: string;
}

export interface DefaultSessionTelemetryAccess {
  readonly sink?: SessionTelemetrySink;
  readonly unavailableMessage: string;
}

export function sessionTelemetryUnavailableMessage(
  env: NodeJS.ProcessEnv = process.env,
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
  return (
    "Session telemetry is off. Set XRK_TELEMETRY=memory, or XRK_TELEMETRY=1 " +
    "with an OTLP logs endpoint. See docs/session-telemetry.md."
  );
}

/**
 * Resolve a session-telemetry sink.
 * - Injected `sink` wins.
 * - `XRK_TELEMETRY=0` → disabled.
 * - `XRK_TELEMETRY=memory` → memory sink.
 * - `XRK_TELEMETRY=1` / `otlp` + endpoint → OTLP/HTTP logs.
 * - Else if a standard OTEL_* endpoint is set → OTLP (opt-in via endpoint alone).
 */
export function createDefaultSessionTelemetryAccess(
  options: DefaultSessionTelemetryAccessOptions = {},
): DefaultSessionTelemetryAccess {
  const env = options.env ?? process.env;
  const unavailableMessage = sessionTelemetryUnavailableMessage(env);
  if (options.sink) {
    return { sink: options.sink, unavailableMessage };
  }
  const flag = String(env.XRK_TELEMETRY ?? "").trim().toLowerCase();
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
    flag === "1" ||
    flag === "otlp" ||
    flag === "otel" ||
    (flag === "" && Boolean(endpoint));
  if (wantOtlp) {
    if (!endpoint) {
      return { unavailableMessage };
    }
    const headersRaw = String(env.OTEL_EXPORTER_OTLP_HEADERS ?? "").trim();
    const headers: Record<string, string> = {};
    if (headersRaw) {
      for (const part of headersRaw.split(",")) {
        const idx = part.indexOf("=");
        if (idx <= 0) continue;
        headers[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
      }
    }
    return {
      sink: createOtlpHttpSessionTelemetrySink({
        endpoint,
        ...(Object.keys(headers).length ? { headers } : {}),
        ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
        ...(options.serviceName
          ? { serviceName: options.serviceName }
          : {}),
      }),
      unavailableMessage,
    };
  }
  return { unavailableMessage };
}
