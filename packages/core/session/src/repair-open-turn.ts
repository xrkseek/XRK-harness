import type { SessionEvent } from "@xrkseek/protocol";
import {
  danglingSettlement,
  listDanglingToolCalls,
} from "./dangling.js";

/** Latest attempt only — skip chunks before the last in-step `llm/retry`. */
function foldStepStreamChunks(
  events: readonly SessionEvent[],
  turnId: string,
  stepId: string,
): {
  readonly content: string;
  readonly reasoning: string;
  readonly toolCalls: import("@xrkseek/protocol").ToolCall[];
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
    .map(([, acc]) => {
      let argumentsValue: unknown;
      try {
        argumentsValue = acc.arguments ? JSON.parse(acc.arguments) : {};
      } catch {
        argumentsValue = acc.arguments;
      }
      return {
        id: acc.id,
        name: acc.name ?? "unknown",
        arguments: argumentsValue,
      };
    });
  return { content, reasoning, toolCalls };
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
    const settled = danglingSettlement(d);
    out.push({
      type: "tool/result",
      ts: ts(),
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

  const stepId = findOpenStepId(events, turnId);
  if (stepId !== undefined) {
    if (!stepHasAssistantMessage(events, turnId, stepId)) {
      const folded = foldStepStreamChunks(events, turnId, stepId);
      if (
        folded.content.trim() ||
        folded.reasoning.trim() ||
        folded.toolCalls.length > 0
      ) {
        out.push({
          type: "assistant/message",
          ts: ts(),
          turnId,
          stepId,
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
