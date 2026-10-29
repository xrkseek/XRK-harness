import type { SessionTelemetryRecord } from "./types.js";

/**
 * Return a sanitized record, or `undefined` to drop the emit (fail-closed).
 * Throwing from a rule is treated as drop.
 */
export type RedactionRule = (
  record: SessionTelemetryRecord,
) => SessionTelemetryRecord | undefined;

const BODY_TEXT_KEYS = new Set([
  "content",
  "text",
  "args",
  "result",
  "input",
  "output",
  "prompt",
  "message",
  "delta",
  "chunks",
]);

function redactValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    return { elided: true, bytes: Buffer.byteLength(value, "utf8") };
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = BODY_TEXT_KEYS.has(k) ? redactValue(v) : v;
    }
    return out;
  }
  return value;
}

/** Default rule: strip prompt/tool payload text; keep type/structure + lengths. */
export function basicRedactionRule(
  record: SessionTelemetryRecord,
): SessionTelemetryRecord {
  if (record.channel !== "ledger") return record;
  return {
    ...record,
    body: redactValue(record.body),
  };
}

/**
 * Apply rules in order. Any throw or `undefined` return drops the record
 * (caller must not emit).
 */
export function applyRedaction(
  record: SessionTelemetryRecord,
  rules: readonly RedactionRule[],
): SessionTelemetryRecord | undefined {
  let current: SessionTelemetryRecord | undefined = record;
  for (const rule of rules) {
    if (!current) return undefined;
    try {
      current = rule(current);
    } catch {
      return undefined;
    }
  }
  return current;
}
