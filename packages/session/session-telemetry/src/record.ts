import type { SessionEvent } from "@xrkseek/protocol";
import type {
  SessionTelemetryRecord,
  SessionTelemetrySeverity,
} from "./types.js";

function severityFor(event: SessionEvent): SessionTelemetrySeverity {
  if (event.type === "tool/result") {
    const result = event.result as { isError?: boolean } | undefined;
    if (result?.isError === true) return "error";
  }
  if (event.type === "turn/end") {
    const reason = event.reason as { kind?: string } | undefined;
    if (reason?.kind === "error" || reason?.kind === "aborted") return "error";
  }
  if (event.type === "safety/notice") return "warn";
  return "info";
}

/**
 * Build a ledger record from a session append (deep-ish JSON clone of body).
 */
export function recordFromSessionEvent(
  sessionId: string,
  event: SessionEvent,
  seq: number,
): SessionTelemetryRecord {
  const { type, ts, ...rest } = event;
  let body: unknown;
  try {
    body = JSON.parse(JSON.stringify(rest)) as unknown;
  } catch {
    body = { note: "non-json body elided" };
  }
  return {
    channel: "ledger",
    time: typeof ts === "number" && Number.isFinite(ts) ? ts : Date.now(),
    severity: severityFor(event),
    attributes: {
      "session.id": sessionId,
      "event.type": type,
      "event.seq": seq,
      "telemetry.schema": "xrk.session.v1",
    },
    body,
  };
}

export function opsRecord(
  sessionId: string,
  op: string,
  body: unknown = {},
  severity: SessionTelemetrySeverity = "info",
): SessionTelemetryRecord {
  return {
    channel: "ops",
    time: Date.now(),
    severity,
    attributes: {
      "session.id": sessionId,
      "telemetry.op": op,
      "telemetry.schema": "xrk.session.v1",
    },
    body,
  };
}
