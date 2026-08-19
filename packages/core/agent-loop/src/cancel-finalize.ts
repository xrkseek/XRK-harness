import type { SessionEvent } from "@xrkseek/protocol";
import type { SessionStore } from "@xrkseek/core-session";

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

/** Fold logged stream chunks for one step into assistant text surfaces. */
export function foldStepStreamChunks(
  events: readonly SessionEvent[],
  turnId: string,
  stepId: string,
): { readonly content: string; readonly reasoning: string } {
  let content = "";
  let reasoning = "";
  for (const ev of events) {
    if (ev.type !== "assistant/chunk") continue;
    if (ev.turnId !== turnId || ev.stepId !== stepId) continue;
    if (ev.kind === "reasoning") reasoning += ev.text;
    else content += ev.text;
  }
  return { content, reasoning };
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
      if (folded.content.trim() || folded.reasoning.trim()) {
        input.store.append(input.sessionId, {
          type: "assistant/message",
          ts: input.now(),
          turnId: input.turnId,
          stepId: input.stepId,
          content: folded.content,
          ...(folded.reasoning.trim()
            ? { reasoning: folded.reasoning }
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

  if (!turnHasEnd(events(), input.turnId)) {
    input.store.append(input.sessionId, {
      type: "turn/end",
      ts: input.now(),
      turnId: input.turnId,
      reason: { kind: "aborted" },
    });
  }
}
