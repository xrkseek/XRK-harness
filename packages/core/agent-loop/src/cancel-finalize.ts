import type { SessionEvent, ToolCall } from "@xrkseek/protocol";
import {
  settleDanglingTools,
  type SessionStore,
} from "@xrkseek/core-session";

export function isAbortError(
  err: unknown,
  signal?: AbortSignal,
): boolean {
  return (
    err instanceof DOMException &&
    err.name === "AbortError" &&
    signal?.aborted === true
  );
}

function parseArgsFragment(raw: string): unknown {
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return raw;
  }
}

/** Fold logged stream chunks for one step into assistant text / tool surfaces. */
export function foldStepStreamChunks(
  events: readonly SessionEvent[],
  turnId: string,
  stepId: string,
): {
  readonly content: string;
  readonly reasoning: string;
  readonly toolCalls: readonly ToolCall[];
} {
  let content = "";
  let reasoning = "";
  const byIndex = new Map<
    number,
    { id: string; name?: string; arguments: string }
  >();
  for (const ev of events) {
    if (ev.type !== "assistant/chunk") continue;
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
}): void {
  const events = () => input.store.get(input.sessionId).events;

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
      reason: { kind: "aborted" },
    });
  }
}
