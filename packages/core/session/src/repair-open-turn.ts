import type { SessionEvent } from "@xrkseek/protocol";
import {
  listDanglingToolCalls,
  TOOL_INTERRUPTED_MESSAGE,
} from "./dangling.js";

function foldStepStreamChunks(
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

function findOpenTurnId(events: readonly SessionEvent[]): string | undefined {
  const ended = new Set<string>();
  let lastOpen: string | undefined;
  for (const ev of events) {
    if (ev.type === "turn/start") lastOpen = ev.turnId;
    if (ev.type === "turn/end") {
      ended.add(ev.turnId);
      if (ev.turnId === lastOpen) lastOpen = undefined;
    }
  }
  if (lastOpen !== undefined && ended.has(lastOpen)) return undefined;
  return lastOpen;
}

function findOpenStepId(
  events: readonly SessionEvent[],
  turnId: string,
): string | undefined {
  const ended = new Set<string>();
  let lastOpen: string | undefined;
  for (const ev of events) {
    if (!("turnId" in ev) || ev.turnId !== turnId) continue;
    if (ev.type === "step/start") lastOpen = ev.stepId;
    if (ev.type === "step/end") {
      ended.add(ev.stepId);
      if (ev.stepId === lastOpen) lastOpen = undefined;
    }
  }
  if (lastOpen !== undefined && ended.has(lastOpen)) return undefined;
  return lastOpen;
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

/**
 * Events to append after a crash left a turn/step open in durable storage.
 * Settles dangling tools, folds streamed prefix, closes step/turn with
 * `reason: { kind: "interrupted" }`.
 */
export function repairOpenTurnEvents(
  events: readonly SessionEvent[],
  now: () => number = Date.now,
): SessionEvent[] {
  const turnId = findOpenTurnId(events);
  if (turnId === undefined) return [];

  const out: SessionEvent[] = [];
  const ts = () => now();

  for (const d of listDanglingToolCalls(events)) {
    out.push({
      type: "tool/result",
      ts: ts(),
      turnId: d.turnId,
      stepId: d.stepId,
      result: {
        toolCallId: d.call.id,
        name: d.call.name,
        content: TOOL_INTERRUPTED_MESSAGE,
        isError: true,
      },
    });
  }

  const stepId = findOpenStepId(events, turnId);
  if (stepId !== undefined) {
    if (!stepHasAssistantMessage(events, turnId, stepId)) {
      const folded = foldStepStreamChunks(events, turnId, stepId);
      if (folded.content.trim() || folded.reasoning.trim()) {
        out.push({
          type: "assistant/message",
          ts: ts(),
          turnId,
          stepId,
          content: folded.content,
          ...(folded.reasoning.trim()
            ? { reasoning: folded.reasoning }
            : {}),
          interrupted: true,
        });
      }
    }
    out.push({
      type: "step/end",
      ts: ts(),
      turnId,
      stepId,
    });
  }

  out.push({
    type: "turn/end",
    ts: ts(),
    turnId,
    reason: { kind: "interrupted" },
  });

  return out;
}
