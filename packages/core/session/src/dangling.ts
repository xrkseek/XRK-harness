import { readSessionEvents } from "./seq.js";
import type { SessionEvent, ToolCall } from "@xrkseek/protocol";
import {
  TOOL_ABORTED_BEFORE_DISPATCH,
  TOOL_ABORTED_BEFORE_DISPATCH_MESSAGE,
} from "@xrkseek/protocol";
export {
  TOOL_ABORTED,
  TOOL_ABORTED_BEFORE_DISPATCH,
  TOOL_ABORTED_MESSAGE,
  TOOL_ABORTED_BEFORE_DISPATCH_MESSAGE,
} from "@xrkseek/protocol";
import type { SessionStore } from "./index.js";

/** @deprecated Prefer source-specific messages below. */
export const TOOL_INTERRUPTED_MESSAGE = "Tool execution interrupted";

/** Recovery code: assistant named the call but no `tool/call` was recorded. */
export const TOOL_NOT_STARTED = "TOOL_NOT_STARTED";

/** Recovery code: `tool/call` recorded but no durable `tool/result`. */
export const TOOL_OUTCOME_UNKNOWN = "TOOL_OUTCOME_UNKNOWN";

export const TOOL_NOT_STARTED_MESSAGE =
  "The tool call was interrupted before the Harness recorded it as started. Retry it if it is still needed.";

export const TOOL_OUTCOME_UNKNOWN_MESSAGE =
  "The tool call was interrupted after it was recorded, but no result was durably recorded. Its outcome is unknown. Decide whether to retry from the tool semantics: retry only if the operation is read-only or idempotent; if it may have side effects, first verify external state or ask the user. Do not retry blindly.";

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

export function danglingSettlement(d: DanglingToolCall): {
  readonly content: string;
  readonly error: { readonly name: string; readonly code: string };
} {
  if (d.source === "tool/call") {
    return {
      content: TOOL_OUTCOME_UNKNOWN_MESSAGE,
      error: { name: "ToolOutcomeUnknownError", code: TOOL_OUTCOME_UNKNOWN },
    };
  }
  return {
    content: TOOL_NOT_STARTED_MESSAGE,
    error: { name: "ToolNotStartedError", code: TOOL_NOT_STARTED },
  };
}

export function abortedBeforeDispatchSettlement(): {
  readonly content: string;
  readonly error: { readonly name: string; readonly code: string };
} {
  return {
    content: TOOL_ABORTED_BEFORE_DISPATCH_MESSAGE,
    error: {
      name: "AbortError",
      code: TOOL_ABORTED_BEFORE_DISPATCH,
    },
  };
}

export interface SettleDanglingOptions {
  readonly now?: () => number;
  /** @deprecated Ignored; settlement text is source-specific (DSH repair). */
  readonly message?: string;
  /**
   * `aborted-before-dispatch` — cancel path (known: body never ran).
   * Default `crash` — source-specific unknown / not-started codes.
   */
  readonly kind?: "crash" | "aborted-before-dispatch";
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
  const dangling = listDanglingToolCalls(readSessionEvents(store, sessionId));
  for (const d of dangling) {
    const settled =
      options.kind === "aborted-before-dispatch"
        ? abortedBeforeDispatchSettlement()
        : danglingSettlement(d);
    store.append(sessionId, {
      type: "tool/result",
      ts: now(),
      turnId: d.turnId,
      stepId: d.stepId,
      result: {
        toolCallId: d.call.id,
        name: d.call.name,
        content: settled.content,
        isError: true,
        error: settled.error,
      },
    });
  }
  return { settled: dangling };
}
