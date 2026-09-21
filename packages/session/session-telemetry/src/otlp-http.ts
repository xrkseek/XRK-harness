/**
 * OTLP/HTTP logs exporter (JSON). No @opentelemetry SDK dependency —
 * maps SessionTelemetryRecord → logRecords and POSTs to the collector.
 */
import type { SessionTelemetryRecord, SessionTelemetrySink } from "./types.js";
import { SessionTelemetryError } from "./types.js";

export type OtlpFetch = (
  input: string,
  init: RequestInit,
) => Promise<Response>;

export interface OtlpHttpSessionTelemetryOptions {
  /** Full logs endpoint, e.g. http://localhost:4318/v1/logs */
  readonly endpoint: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly fetchImpl?: OtlpFetch;
  readonly serviceName?: string;
  readonly maxQueue?: number;
  /** Flush when queue reaches this size (default 32). */
  readonly batchSize?: number;
  readonly flushIntervalMs?: number;
}

const SEVERITY_NUMBER: Record<string, number> = {
  info: 9,
  warn: 13,
  error: 17,
};

function attrKv(
  key: string,
  value: string | number | boolean,
): Record<string, unknown> {
  if (typeof value === "string") {
    return { key, value: { stringValue: value } };
  }
  if (typeof value === "boolean") {
    return { key, value: { boolValue: value } };
  }
  if (Number.isInteger(value)) {
    return { key, value: { intValue: value } };
  }
  return { key, value: { doubleValue: value } };
}

function toLogRecord(record: SessionTelemetryRecord): Record<string, unknown> {
  const attrs = Object.entries(record.attributes).map(([k, v]) =>
    attrKv(k, v),
  );
  attrs.push(attrKv("telemetry.channel", record.channel));
  let bodyText: string;
  try {
    bodyText =
      typeof record.body === "string"
        ? record.body
        : JSON.stringify(record.body);
  } catch {
    bodyText = "[unserializable]";
  }
  return {
    timeUnixNano: String(BigInt(Math.max(0, record.time)) * 1_000_000n),
    severityNumber: SEVERITY_NUMBER[record.severity] ?? 9,
    severityText: record.severity.toUpperCase(),
    body: { stringValue: bodyText },
    attributes: attrs,
  };
}

/**
 * Create an OTLP/HTTP logs sink. `emit` enqueues; export runs async.
 */
export function createOtlpHttpSessionTelemetrySink(
  options: OtlpHttpSessionTelemetryOptions,
): SessionTelemetrySink {
  const endpoint = options.endpoint.trim();
  if (!endpoint) {
    throw new SessionTelemetryError(
      "OTLP endpoint is empty",
      "SESSION_TELEMETRY_CONFIG",
    );
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const serviceName = options.serviceName ?? "xrk-harness";
  const maxQueue = options.maxQueue ?? 2048;
  const batchSize = options.batchSize ?? 32;
  const flushIntervalMs = options.flushIntervalMs ?? 2000;
  const queue: SessionTelemetryRecord[] = [];
  let flushing: Promise<void> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let closed = false;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers ?? {}),
  };

  const exportBatch = async (batch: SessionTelemetryRecord[]): Promise<void> => {
    if (batch.length === 0) return;
    const payload = {
      resourceLogs: [
        {
          resource: {
            attributes: [
              attrKv("service.name", serviceName),
              attrKv("telemetry.sdk.name", "xrk-session-telemetry"),
              attrKv("telemetry.sdk.language", "nodejs"),
            ],
          },
          scopeLogs: [
            {
              scope: {
                name: "xrk.session",
                version: "0.1.0",
              },
              logRecords: batch.map(toLogRecord),
            },
          ],
        },
      ],
    };
    const res = await fetchImpl(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new SessionTelemetryError(
        `OTLP export HTTP ${res.status}: ${text.slice(0, 200)}`,
        "SESSION_TELEMETRY_EXPORT",
      );
    }
  };

  const drain = async (): Promise<void> => {
    while (queue.length > 0) {
      const batch = queue.splice(0, batchSize);
      try {
        await exportBatch(batch);
      } catch {
        // Drop failed batch — observability must not block or crash Host.
      }
    }
  };

  const scheduleFlush = (): void => {
    if (flushing) return;
    flushing = drain().finally(() => {
      flushing = undefined;
    });
  };

  timer = setInterval(() => {
    if (queue.length > 0) scheduleFlush();
  }, flushIntervalMs);
  timer.unref?.();

  return {
    emit(record) {
      if (closed) return;
      queue.push(record);
      if (queue.length > maxQueue) {
        queue.splice(0, queue.length - maxQueue);
      }
      if (queue.length >= batchSize) scheduleFlush();
    },
    flush() {
      scheduleFlush();
    },
    async shutdown() {
      closed = true;
      if (timer) {
        clearInterval(timer);
        timer = undefined;
      }
      scheduleFlush();
      await flushing;
      await drain();
    },
  };
}

/**
 * Resolve OTLP logs URL from standard OpenTelemetry env (+ XRK override).
 */
export function resolveOtlpLogsEndpoint(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const direct = String(
    env.XRK_TELEMETRY_OTLP_ENDPOINT ??
      env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT ??
      "",
  ).trim();
  if (direct) return direct;
  const base = String(env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "").trim();
  if (!base) return undefined;
  if (base.endsWith("/v1/logs")) return base;
  return `${base.replace(/\/+$/, "")}/v1/logs`;
}
