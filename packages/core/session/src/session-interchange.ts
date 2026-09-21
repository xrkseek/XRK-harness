/**
 * Cross-product transcript interchange.
 * Converts role JSONL ↔ XRK session events. Not SQLite schema v3 and not
 * third-party Session Format V3 (ADR-0009).
 */
import type { SessionEvent } from "@xrkseek/protocol";
import { assertSessionEvent } from "@xrkseek/protocol";

export const SESSION_INTERCHANGE_VERSION = 1;

export type InterchangeRole = "user" | "assistant" | "tool";

export interface InterchangeMessage {
  readonly role: InterchangeRole;
  readonly text: string;
  /** tool call / result */
  readonly name?: string;
  readonly callId?: string;
  /** "call" emits tool/call; "result" (default) emits tool/result. */
  readonly phase?: "call" | "result";
  readonly arguments?: unknown;
  readonly ts?: number;
}

function messageText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((part) => {
        if (!part || typeof part !== "object") return "";
        const row = part as { text?: unknown };
        return typeof row.text === "string" ? row.text : "";
      })
      .join("");
  }
  return "";
}

function roleOf(raw: Record<string, unknown>): InterchangeRole | undefined {
  const role = raw.role ?? raw.type;
  if (role === "user" || role === "human") return "user";
  if (role === "assistant" || role === "agent" || role === "model") {
    return "assistant";
  }
  if (role === "tool" || role === "function") return "tool";
  return undefined;
}

function timestampOf(raw: Record<string, unknown>): number | undefined {
  const value = raw.ts ?? raw.timestamp;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function toolCallsOf(raw: Record<string, unknown>): InterchangeMessage[] {
  const calls = raw.tool_calls ?? raw.toolCalls;
  if (!Array.isArray(calls)) return [];
  const out: InterchangeMessage[] = [];
  for (const call of calls) {
    if (!call || typeof call !== "object") continue;
    const row = call as {
      id?: unknown;
      name?: unknown;
      arguments?: unknown;
      function?: { name?: unknown; arguments?: unknown };
    };
    const fn = row.function;
    const name = typeof row.name === "string" ? row.name : fn?.name;
    if (typeof name !== "string" || !name) continue;
    const id = typeof row.id === "string" && row.id ? row.id : `call_${out.length}`;
    let args: unknown = row.arguments ?? fn?.arguments ?? {};
    if (typeof args === "string") {
      try {
        args = JSON.parse(args);
      } catch {
        args = { raw: args };
      }
    }
    const ts = timestampOf(raw);
    out.push({
      role: "tool",
      text: "",
      name,
      callId: id,
      phase: "call",
      arguments: args,
      ...(ts !== undefined ? { ts } : {}),
    });
  }
  return out;
}

/** Pull user/assistant/tool lines. Skips the interchange header and unknown rows. */
export function readSessionInterchange(text: string): InterchangeMessage[] {
  const out: InterchangeMessage[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    if (row.xrkInterchange === SESSION_INTERCHANGE_VERSION) continue;
    const role = roleOf(row);
    if (!role) continue;
    const ts = timestampOf(row);
    if (role === "tool") {
      const name = typeof row.name === "string" ? row.name : "tool";
      const callId =
        typeof row.callId === "string"
          ? row.callId
          : typeof row.tool_call_id === "string"
            ? row.tool_call_id
            : typeof row.id === "string"
              ? row.id
              : `call_${out.length}`;
      const phase = row.phase === "call" ? "call" : "result";
      out.push({
        role,
        text: messageText(row.text ?? row.content ?? row.message ?? row.body),
        name,
        callId,
        phase,
        ...(row.arguments !== undefined ? { arguments: row.arguments } : {}),
        ...(ts !== undefined ? { ts } : {}),
      });
      continue;
    }
    const textBody = messageText(
      row.text ?? row.content ?? row.message ?? row.body,
    ).trim();
    const calls = role === "assistant" ? toolCallsOf(row) : [];
    if (!textBody && calls.length === 0) continue;
    if (textBody) {
      out.push({
        role,
        text: textBody,
        ...(ts !== undefined ? { ts } : {}),
      });
    }
    out.push(...calls);
  }
  return out;
}

function splitTurns(messages: readonly InterchangeMessage[]): InterchangeMessage[][] {
  const turns: InterchangeMessage[][] = [];
  let current: InterchangeMessage[] = [];
  let sawModel = false;
  for (const message of messages) {
    if (message.role === "user" && sawModel && current.length > 0) {
      turns.push(current);
      current = [];
      sawModel = false;
    }
    current.push(message);
    if (message.role !== "user") sawModel = true;
  }
  if (current.length > 0) turns.push(current);
  return turns;
}

/** XRK events for an imported transcript. Does not touch the session store. */
export function importSessionInterchange(
  text: string,
  now = Date.now(),
): SessionEvent[] {
  const turns = splitTurns(readSessionInterchange(text));
  const built: unknown[] = [];
  turns.forEach((messages, turnIndex) => {
    const turnId = `turn_interchange_${turnIndex}`;
    const stepId = `step_interchange_${turnIndex}`;
    const openedAt = messages.find((row) => row.ts !== undefined)?.ts ?? now;
    built.push(
      { type: "turn/start", ts: openedAt, turnId },
      { type: "step/start", ts: openedAt, turnId, stepId },
    );
    let index = 0;
    for (const message of messages) {
      const ts = message.ts ?? openedAt;
      if (message.role === "user") {
        built.push({
          type: "user/message",
          ts,
          turnId,
          messageId: `umsg_interchange_${turnIndex}_${index}`,
          content: message.text,
        });
      } else if (message.role === "assistant") {
        built.push({
          type: "assistant/message",
          ts,
          turnId,
          stepId,
          content: message.text,
        });
      } else if (message.phase === "call") {
        built.push({
          type: "tool/call",
          ts,
          turnId,
          stepId,
          call: {
            id: message.callId ?? `call_${turnIndex}_${index}`,
            name: message.name ?? "tool",
            arguments: message.arguments ?? {},
          },
        });
      } else {
        built.push({
          type: "tool/result",
          ts,
          turnId,
          stepId,
          result: {
            toolCallId: message.callId ?? `call_${turnIndex}_${index}`,
            name: message.name ?? "tool",
            content: message.text,
          },
        });
      }
      index += 1;
    }
    const closedAt = messages.at(-1)?.ts ?? openedAt;
    built.push(
      { type: "step/end", ts: closedAt, turnId, stepId },
      { type: "turn/end", ts: closedAt, turnId, reason: { kind: "completed" } },
    );
  });
  return built.map((row) => assertSessionEvent(row));
}

function eventText(event: SessionEvent): InterchangeMessage | undefined {
  if (event.type === "user/message") {
    const text = messageText(event.content).trim();
    return text ? { role: "user", text, ts: event.ts } : undefined;
  }
  if (event.type === "assistant/message") {
    const text = event.content.trim();
    return text ? { role: "assistant", text, ts: event.ts } : undefined;
  }
  if (event.type === "tool/call") {
    return {
      role: "tool",
      text: "",
      name: event.call.name,
      callId: event.call.id,
      phase: "call",
      arguments: event.call.arguments,
      ts: event.ts,
    };
  }
  if (event.type === "tool/result") {
    return {
      role: "tool",
      text: messageText(event.result.content),
      name: event.result.name,
      callId: event.result.toolCallId,
      phase: "result",
      ts: event.ts,
    };
  }
  return undefined;
}

/** Portable role JSONL. Header marks this as interchange, not schema v3. */
export function exportSessionInterchange(events: readonly SessionEvent[]): string {
  const lines: unknown[] = [
    {
      xrkInterchange: SESSION_INTERCHANGE_VERSION,
      kind: "transcript",
      not: ["sqlite-schema-v3", "session-format-v3"],
    },
  ];
  for (const event of events) {
    const message = eventText(event);
    if (!message) continue;
    const row: Record<string, unknown> = {
      role: message.role,
      ...(message.role === "tool" ? { content: message.text } : { text: message.text }),
    };
    if (message.ts !== undefined) row.ts = message.ts;
    if (message.role === "tool") {
      row.name = message.name;
      row.callId = message.callId;
      row.phase = message.phase;
      if (message.phase === "call") row.arguments = message.arguments ?? {};
    }
    lines.push(row);
  }
  return `${lines.map((row) => JSON.stringify(row)).join("\n")}\n`;
}
