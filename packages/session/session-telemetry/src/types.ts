/**
 * Session telemetry Definition — capture-side records + sink contract.
 * Downstream batching/retry/loss is the exporter's job (see otlp-http).
 */

export type SessionTelemetrySeverity = "info" | "warn" | "error";

export type SessionTelemetryChannel = "ledger" | "ops";

/**
 * One logical record handed to a backend.
 * Ledger rows mirror session-log events; ops rows carry signals with no log home.
 */
export interface SessionTelemetryRecord {
  readonly channel: SessionTelemetryChannel;
  /** Unix epoch milliseconds. */
  readonly time: number;
  readonly severity: SessionTelemetrySeverity;
  readonly attributes: Readonly<Record<string, string | number | boolean>>;
  readonly body: unknown;
}

/**
 * Minimum backend contract. `emit` MUST be non-blocking (enqueue only).
 */
export interface SessionTelemetrySink {
  emit(record: SessionTelemetryRecord): void;
  /** Optional flush hint after a turn; fire-and-forget. */
  flush?(): void;
  /** Drain queued export; awaited on Host stop / tests. */
  shutdown(): Promise<void>;
}

export class SessionTelemetryError extends Error {
  readonly code: string;

  constructor(message: string, code = "SESSION_TELEMETRY") {
    super(message);
    this.name = "SessionTelemetryError";
    this.code = code;
  }
}
