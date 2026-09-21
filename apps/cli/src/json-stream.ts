/**
 * `--json` run projection: newline-delimited events from the durable session log.
 * Text/thinking come from committed `assistant/message` only (no live attempt).
 */

import { Buffer } from "node:buffer";
import { flattenText, type SessionEvent } from "@xrkseek/protocol";

export const MAX_STRING_BYTES = 8 * 1024;
export const MAX_EVENT_BYTES = 32 * 1024;
const LINE_TERMINATOR_BYTES = 1;
const MAX_DEPTH = 64;

export interface JsonSink {
  write(chunk: string): unknown;
}

interface BoundState {
  truncated: boolean;
}

function truncateUtf8(text: string, maxBytes: number): string {
  const buffer = Buffer.from(text, "utf8").subarray(0, maxBytes);
  const decoded = buffer.toString("utf8");
  return decoded.endsWith("\uFFFD") ? decoded.slice(0, -1) : decoded;
}

function boundKey(key: string, maxBytes: number, state: BoundState): string {
  if (Buffer.byteLength(key, "utf8") <= maxBytes) return key;
  state.truncated = true;
  return truncateUtf8(key, maxBytes);
}

function boundValue(
  value: unknown,
  maxBytes: number,
  state: BoundState,
  depth = 0,
): unknown {
  if (typeof value === "string") {
    if (Buffer.byteLength(value, "utf8") <= maxBytes) return value;
    state.truncated = true;
    return truncateUtf8(value, maxBytes);
  }
  if (Array.isArray(value)) {
    if (depth >= MAX_DEPTH) {
      state.truncated = true;
      return "[truncated: depth]";
    }
    return value.map((item) => boundValue(item, maxBytes, state, depth + 1));
  }
  if (value !== null && typeof value === "object") {
    if (depth >= MAX_DEPTH) {
      state.truncated = true;
      return "[truncated: depth]";
    }
    const bounded = Object.create(null) as Record<string, unknown>;
    for (const [key, item] of Object.entries(value)) {
      bounded[boundKey(key, maxBytes, state)] = boundValue(
        item,
        maxBytes,
        state,
        depth + 1,
      );
    }
    return bounded;
  }
  return value;
}

function boundJsonEvent(
  event: Record<string, unknown>,
  maxStringBytes: number,
): Record<string, unknown> {
  const state: BoundState = { truncated: false };
  const bounded = boundValue(event, maxStringBytes, state) as Record<
    string,
    unknown
  >;
  if (state.truncated) bounded.truncated = true;
  return bounded;
}

/** Serialize one event under string + line byte caps (newline reserved). */
export function boundJsonLine(
  event: Record<string, unknown>,
  maxStringBytes: number = MAX_STRING_BYTES,
  maxEventBytes: number = MAX_EVENT_BYTES,
): string {
  const limit = maxEventBytes - LINE_TERMINATOR_BYTES;
  const bounded = boundJsonEvent(event, maxStringBytes);
  const line = JSON.stringify(bounded);
  if (Buffer.byteLength(line, "utf8") <= limit) return line;
  const scalars = Object.create(null) as Record<string, unknown>;
  for (const [key, value] of Object.entries(bounded)) {
    if (value === null || typeof value !== "object") scalars[key] = value;
  }
  scalars.truncated = true;
  const short = JSON.stringify(scalars);
  if (Buffer.byteLength(short, "utf8") <= limit) return short;
  return JSON.stringify({ type: bounded.type, truncated: true });
}

function parseArguments(raw: string): unknown {
  if (raw === "") return {};
  let nonFinite = false;
  try {
    const parsed = JSON.parse(raw, (_key, value: unknown) => {
      if (typeof value === "number" && !Number.isFinite(value)) nonFinite = true;
      return value;
    }) as unknown;
    return nonFinite ? raw : parsed;
  } catch {
    return raw;
  }
}

/** Project one durable session event to zero or more `--json` payloads. */
export function projectSessionEvent(
  event: SessionEvent,
): readonly Record<string, unknown>[] {
  switch (event.type) {
    case "turn/start":
      return [{ type: "status", phase: "turn_start", turnId: event.turnId }];
    case "step/start":
      return [
        {
          type: "status",
          phase: "step_start",
          turnId: event.turnId,
          stepId: event.stepId,
        },
      ];
    case "step/end":
      return [
        {
          type: "status",
          phase: "step_end",
          turnId: event.turnId,
          stepId: event.stepId,
        },
      ];
    case "turn/end":
      return [
        {
          type: "status",
          phase: "turn_end",
          turnId: event.turnId,
          reason: event.reason,
        },
      ];
    case "assistant/message": {
      const out: Record<string, unknown>[] = [];
      if (typeof event.reasoning === "string" && event.reasoning.length > 0) {
        out.push({ type: "thinking", text: event.reasoning });
      }
      if (typeof event.content === "string" && event.content.length > 0) {
        out.push({ type: "text", text: event.content });
      }
      return out;
    }
    case "tool/call": {
      const raw = event.call.arguments;
      const input =
        typeof raw === "string"
          ? parseArguments(raw)
          : raw === undefined
            ? {}
            : raw;
      return [
        {
          type: "tool_call",
          callId: event.call.id,
          tool: event.call.name,
          input,
        },
      ];
    }
    case "tool/result":
      return [
        {
          type: "tool_result",
          callId: event.result.toolCallId,
          text: flattenText(event.result.content),
          ...(event.result.isError === true ? { isError: true } : {}),
        },
      ];
    default:
      return [];
  }
}

export interface JsonRunProjection {
  /** Emit newly appended events since the last poll (`fromSeq` inclusive). */
  poll(events: readonly SessionEvent[], fromSeq: number): number;
  finish(text: string): void;
  error(message: string): void;
  write(event: Record<string, unknown>): void;
}

export function createJsonRunProjection(
  sink: JsonSink,
  options: { maxStringBytes?: number } = {},
): JsonRunProjection {
  const maxStringBytes = options.maxStringBytes ?? MAX_STRING_BYTES;
  let nextSeq = 0;
  const write = (event: Record<string, unknown>): void => {
    sink.write(`${boundJsonLine(event, maxStringBytes)}\n`);
  };
  return {
    write,
    poll(events, fromSeq) {
      const start = Math.max(fromSeq, nextSeq);
      for (let i = start; i < events.length; i += 1) {
        const ev = events[i];
        if (ev === undefined) continue;
        for (const payload of projectSessionEvent(ev)) write(payload);
      }
      nextSeq = events.length;
      return nextSeq;
    },
    finish(text) {
      write({ type: "final", text });
    },
    error(message) {
      writeJsonError(sink, message, maxStringBytes);
    },
  };
}

/** One bounded `{ type: "error" }` NDJSON line — shared by CLI entry + `run`. */
export function writeJsonError(
  sink: JsonSink,
  message: string,
  maxStringBytes: number = MAX_STRING_BYTES,
): void {
  sink.write(
    `${boundJsonLine({ type: "error", message }, maxStringBytes)}\n`,
  );
}

/** True when raw argv requests `--json` as a real flag (stops at `--`). */
export function jsonFlagRequested(argv: readonly string[]): boolean {
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--") return false;
    if (argument === "--json") return true;
    if (argument === "--session-id") index += 1;
  }
  return false;
}
