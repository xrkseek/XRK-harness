import type { SessionEvent, ToolCall, TurnEndCancelCause } from "@xrkseek/protocol";
import { settleDanglingTools, type SessionStore, readSessionEvents } from "@xrkseek/core-session";

/**
 * True when `value` is a durable cancel cause (`{ kind: "user" }` etc.).
 * `AbortSignal.abort(cause)` stores these plain objects as `signal.reason`;
 * `throwIfAborted()` then throws them directly — not a DOMException.
 */
export function isAgentCancelCause(value: unknown): value is TurnEndCancelCause {
  if (value === null || typeof value !== "object" || !("kind" in value)) {
    return false;
  }
  const kind = (value as { kind?: unknown }).kind;
  if (
    kind === "user" ||
    kind === "parent" ||
    kind === "disposed" ||
    kind === "legacy"
  ) {
    return true;
  }
  return (
    kind === "hook" &&
    typeof (value as { reason?: unknown }).reason === "string"
  );
}

/** Human-readable abort copy — never `String({ kind: "user" })` → `[object Object]`. */
export function formatAbortReason(reason: unknown): string {
  if (reason === undefined || reason === null) return "aborted";
  if (reason instanceof Error) {
    const message = reason.message.trim();
    return message.length > 0 ? message : reason.name || "aborted";
  }
  if (isAgentCancelCause(reason)) {
    switch (reason.kind) {
      case "user":
        return "aborted by user";
      case "parent":
        return "aborted by parent";
      case "disposed":
        return "aborted: session disposed";
      case "hook":
        return `aborted by hook: ${reason.reason}`;
      case "legacy":
        return "aborted";
    }
  }
  if (typeof reason === "string") {
    const trimmed = reason.trim();
    return trimmed.length > 0 ? trimmed : "aborted";
  }
  try {
    const json = JSON.stringify(reason);
    if (typeof json === "string" && json.length > 0 && json !== "{}") {
      return json;
    }
  } catch {
    /* ignore hostile toJSON */
  }
  return "aborted";
}

/**
 * Cancellation / abort classification for turn finalize.
 *
 * Node `AbortSignal.abort({ kind: "user" })` makes `throwIfAborted()` throw the
 * plain cause object; undici may reject with `Error` named `AbortError` rather
 * than `DOMException`. The old `instanceof DOMException` gate missed both, so
 * stop was logged as `turn/end` `error` with message `[object Object]`.
 */
export function isAbortError(
  err: unknown,
  signal?: AbortSignal,
): boolean {
  if (signal?.aborted === true) {
    if (err === signal.reason) return true;
    if (isAgentCancelCause(err)) return true;
  }
  const name =
    err instanceof DOMException || err instanceof Error ? err.name : undefined;
  if (name === "AbortError") {
    return signal === undefined || signal.aborted === true;
  }
  if (
    err instanceof Error &&
    "code" in err &&
    (err as { code: unknown }).code === "ABORTED"
  ) {
    return signal === undefined || signal.aborted === true;
  }
  return false;
}

function parseArgsFragment(raw: string): unknown {
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return raw;
  }
}

/**
 * Fold logged stream chunks for one step into assistant text / tool surfaces.
 * Only the latest attempt after the last in-step `llm/retry` (client
 * `resetForRetry` parity) so a discarded provider attempt does not paste into
 * the interrupted message.
 */
export function foldStepStreamChunks(
  events: readonly SessionEvent[],
  turnId: string,
  stepId: string,
): {
  readonly content: string;
  readonly reasoning: string;
  readonly toolCalls: readonly ToolCall[];
} {
  let attemptStart = 0;
  for (let i = 0; i < events.length; i += 1) {
    const boundary = events[i];
    if (
      boundary?.type === "llm/retry" &&
      boundary.turnId === turnId &&
      boundary.stepId === stepId
    ) {
      attemptStart = i + 1;
    }
  }
  let content = "";
  let reasoning = "";
  const byIndex = new Map<
    number,
    { id: string; name?: string; arguments: string }
  >();
  for (let i = attemptStart; i < events.length; i += 1) {
    const ev = events[i];
    if (ev === undefined || ev.type !== "assistant/chunk") continue;
    if (ev.turnId !== turnId || ev.stepId !== stepId) continue;
    if (ev.kind === "usage") continue;
    if (ev.kind === "tool-call") {
      const idx = ev.index ?? 0;
      const cur = byIndex.get(idx) ?? {
        id: ev.toolCallId ?? `call_${idx}`,
        arguments: "",
      };
      if (ev.toolCallId) cur.id = ev.toolCallId;
      if (ev.toolName) cur.name = ev.toolName;
      cur.arguments += ev.argumentsDelta ?? ev.text;
      byIndex.set(idx, cur);
      continue;
    }
    if (ev.kind === "reasoning") reasoning += ev.text;
    else content += ev.text;
  }
  const toolCalls = [...byIndex.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, acc]) => ({
      id: acc.id,
      name: acc.name ?? "unknown",
      arguments: parseArgsFragment(acc.arguments),
    }));
  return { content, reasoning, toolCalls };
}

function stepHasAssistantMessage(
  events: readonly SessionEvent[],
  turnId: string,
  stepId: string,
): boolean {
  return events.some(
    (e) =>
      e.type === "assistant/message" &&
      e.turnId === turnId &&
      e.stepId === stepId,
  );
}

function stepHasEnd(
  events: readonly SessionEvent[],
  turnId: string,
  stepId: string,
): boolean {
  return events.some(
    (e) =>
      e.type === "step/end" && e.turnId === turnId && e.stepId === stepId,
  );
}

function turnHasEnd(events: readonly SessionEvent[], turnId: string): boolean {
  return events.some(
    (e) => e.type === "turn/end" && e.turnId === turnId,
  );
}

/**
 * DSH rc.8: commit streamed prefix + close step/turn when cancellation aborts
 * an in-flight model stream so deriveMessages matches what the user saw.
 */
export function finalizeCancelledTurn(input: {
  readonly store: SessionStore;
  readonly sessionId: string;
  readonly turnId: string;
  readonly stepId?: string;
  readonly now: () => number;
  /** Durable cancel cause (DSH). Default `{ kind: "legacy" }`. */
  readonly cancelCause?: TurnEndCancelCause;
}): void {
  const events = () => readSessionEvents(input.store, input.sessionId);

  if (input.stepId !== undefined && !stepHasEnd(events(), input.turnId, input.stepId)) {
    if (!stepHasAssistantMessage(events(), input.turnId, input.stepId)) {
      const folded = foldStepStreamChunks(
        events(),
        input.turnId,
        input.stepId,
      );
      if (
        folded.content.trim() ||
        folded.reasoning.trim() ||
        folded.toolCalls.length > 0
      ) {
        input.store.append(input.sessionId, {
          type: "assistant/message",
          ts: input.now(),
          turnId: input.turnId,
          stepId: input.stepId,
          content: folded.content,
          ...(folded.reasoning.trim()
            ? { reasoning: folded.reasoning }
            : {}),
          ...(folded.toolCalls.length
            ? { toolCalls: folded.toolCalls }
            : {}),
          interrupted: true,
        });
      }
    }
    input.store.append(input.sessionId, {
      type: "step/end",
      ts: input.now(),
      turnId: input.turnId,
      stepId: input.stepId,
    });
  }

  // Cancel path: settle open tools as ABORTED_BEFORE_DISPATCH (not crash-unknown).
  settleDanglingTools(input.store, input.sessionId, {
    now: input.now,
    kind: "aborted-before-dispatch",
  });

  if (!turnHasEnd(events(), input.turnId)) {
    input.store.append(input.sessionId, {
      type: "turn/end",
      ts: input.now(),
      turnId: input.turnId,
      reason: {
        kind: "aborted",
        reason: input.cancelCause ?? { kind: "legacy" },
      },
    });
  }
}
