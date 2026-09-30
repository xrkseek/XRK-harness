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

/**
 * Every `turn/start` without a matching `turn/end`, in start order.
 * Unlike a "latest only" cursor, this keeps earlier orphans visible after a
 * later turn completes (false-idle / abandoned-turn residue).
 */
export function listOpenTurnIds(
  events: readonly SessionEvent[],
): readonly string[] {
  const open = new Set<string>();
  const order: string[] = [];
  for (const ev of events) {
    if (ev.type === "turn/start") {
      if (!open.has(ev.turnId)) order.push(ev.turnId);
      open.add(ev.turnId);
    } else if (ev.type === "turn/end") {
      open.delete(ev.turnId);
    }
  }
  return order.filter((id) => open.has(id));
}

/** True when the log has any `turn/start` with no matching `turn/end`. */
export function sessionHasOpenTurn(events: readonly SessionEvent[]): boolean {
  return listOpenTurnIds(events).length > 0;
}

function findOpenStepId(
  events: readonly SessionEvent[],
  turnId: string,
): string | undefined {
  const open: string[] = [];
  for (const ev of events) {
    if (!("turnId" in ev) || ev.turnId !== turnId) continue;
    if (ev.type === "step/start") open.push(ev.stepId);
    if (ev.type === "step/end") {
      const idx = open.lastIndexOf(ev.stepId);
      if (idx >= 0) open.splice(idx, 1);
    }
  }
  return open[open.length - 1];
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
  return events.some((e) => e.type === "turn/end" && e.turnId === turnId);
}

function closeOneOpenTurn(
  events: readonly SessionEvent[],
  turnId: string,
  openTurnIds: ReadonlySet<string>,
  out: SessionEvent[],
  ts: () => number,
): void {
  const log = (): readonly SessionEvent[] => [...events, ...out];

  const pushSettlements = (): void => {
    for (const d of listDanglingToolCalls(log())) {
      if (!openTurnIds.has(d.turnId)) continue;
      // Already settled in `out` this repair pass.
      if (
        out.some(
          (e) =>
            e.type === "tool/result" &&
            e.result.toolCallId === d.call.id,
        )
      ) {
        continue;
      }
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
  };

  pushSettlements();

  const stepId = findOpenStepId(log(), turnId);
  if (stepId !== undefined && !stepHasEnd(log(), turnId, stepId)) {
    if (!stepHasAssistantMessage(log(), turnId, stepId)) {
      const folded = foldStepStreamChunks(log(), turnId, stepId);
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
        pushSettlements();
      }
    }
    out.push({
      type: "step/end",
      ts: ts(),
      turnId,
      stepId,
    });
  }

  if (!turnHasEnd(log(), turnId)) {
    out.push({
      type: "turn/end",
      ts: ts(),
      turnId,
      reason: { kind: "interrupted" },
    });
  }
}

/**
 * Events to append after a crash left one or more turns/steps open in durable
 * storage. Settles dangling tools (including toolCalls folded from stream
 * chunks), folds streamed prefixes, closes every open step/turn with
 * `reason: { kind: "interrupted" }` (newest open turn first).
 */
export function repairOpenTurnEvents(
  events: readonly SessionEvent[],
  now: () => number = Date.now,
): SessionEvent[] {
  const openIds = listOpenTurnIds(events);
  if (openIds.length === 0) return [];

  const openSet = new Set(openIds);
  const out: SessionEvent[] = [];
  const ts = () => now();

  // Newest first: close the abandoned in-flight turn before older orphans.
  for (const turnId of [...openIds].reverse()) {
    closeOneOpenTurn(events, turnId, openSet, out, ts);
  }

  return out;
}
