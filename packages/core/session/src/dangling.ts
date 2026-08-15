import type { SessionEvent, ToolCall } from "@xrkseek/protocol";
import type { SessionStore } from "./index.js";

/** OpenCode-aligned settlement text for abandoned local tool calls. */
export const TOOL_INTERRUPTED_MESSAGE = "Tool execution interrupted";

export interface DanglingToolCall {
  readonly call: ToolCall;
  readonly turnId: string;
  readonly stepId: string;
  /** Event index of the opening `tool/call` (or synthetic from assistant). */
  readonly openedAt: number;
  readonly source: "tool/call" | "assistant/message";
}

export class ToolSettlementError extends Error {
  readonly dangling: readonly DanglingToolCall[];

  constructor(dangling: readonly DanglingToolCall[]) {
    const ids = dangling.map((d) => d.call.id).join(", ");
    super(`unsettled tool call(s): ${ids}`);
    this.name = "ToolSettlementError";
    this.dangling = dangling;
  }
}

/**
 * Tool calls that have no matching `tool/result` yet (by toolCallId).
 * Also treats `assistant/message.toolCalls` entries without a later result
 * as dangling when no `tool/call` event was written (crash mid-step).
 */
export function listDanglingToolCalls(
  events: readonly SessionEvent[],
): readonly DanglingToolCall[] {
  const open = new Map<string, DanglingToolCall>();

  for (let i = 0; i < events.length; i++) {
    const ev = events[i]!;
    if (ev.type === "tool/call") {
      open.set(ev.call.id, {
        call: ev.call,
        turnId: ev.turnId,
        stepId: ev.stepId,
        openedAt: i,
        source: "tool/call",
      });
      continue;
    }
    if (ev.type === "tool/result") {
      open.delete(ev.result.toolCallId);
      continue;
    }
    if (ev.type === "assistant/message" && ev.toolCalls?.length) {
      for (const call of ev.toolCalls) {
        if (open.has(call.id)) continue;
        // Only open if no result exists later — we don't know yet; add tentatively.
        // Results after this assistant will clear. Prior results already deleted from open.
        open.set(call.id, {
          call,
          turnId: ev.turnId,
          stepId: ev.stepId,
          openedAt: i,
          source: "assistant/message",
        });
      }
    }
  }

  return [...open.values()].sort((a, b) => a.openedAt - b.openedAt);
}

/** Throws if any tool call is still open. */
export function assertToolCallsSettled(events: readonly SessionEvent[]): void {
  const dangling = listDanglingToolCalls(events);
  if (dangling.length > 0) {
    throw new ToolSettlementError(dangling);
  }
}

export interface SettleDanglingOptions {
  readonly now?: () => number;
  readonly message?: string;
}

export interface SettleDanglingResult {
  readonly settled: readonly DanglingToolCall[];
}

/**
 * Append error `tool/result` for every dangling call.
 * Idempotent when called on an already-settled log (no-op).
 * Must run **before** assembling the next model request (fail-before-retry).
 */
export function settleDanglingTools(
  store: SessionStore,
  sessionId: string,
  options: SettleDanglingOptions = {},
): SettleDanglingResult {
  const now = options.now ?? Date.now;
  const message = options.message ?? TOOL_INTERRUPTED_MESSAGE;
  const dangling = listDanglingToolCalls(store.get(sessionId).events);
  for (const d of dangling) {
    store.append(sessionId, {
      type: "tool/result",
      ts: now(),
      turnId: d.turnId,
      stepId: d.stepId,
      result: {
        toolCallId: d.call.id,
        name: d.call.name,
        content: message,
        isError: true,
      },
    });
  }
  return { settled: dangling };
}
