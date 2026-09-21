import type { SessionTelemetryRecord, SessionTelemetrySink } from "./types.js";

export interface MemorySessionTelemetryOptions {
  readonly maxRecords?: number;
}

/**
 * In-memory sink for CI / demos (`XRK_TELEMETRY=memory`).
 */
export function createMemorySessionTelemetrySink(
  options: MemorySessionTelemetryOptions = {},
): SessionTelemetrySink & {
  readonly records: SessionTelemetryRecord[];
} {
  const max = options.maxRecords ?? 10_000;
  const records: SessionTelemetryRecord[] = [];
  return {
    records,
    emit(record) {
      records.push(record);
      if (records.length > max) records.splice(0, records.length - max);
    },
    flush() {},
    async shutdown() {},
  };
}
