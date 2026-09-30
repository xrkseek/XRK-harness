import { describe, expect, it } from "vitest";
import type { SessionEvent } from "@xrkseek/protocol";
import {
  listOpenTurnIds,
  repairOpenTurnEvents,
  sessionHasOpenTurn,
} from "../src/repair-open-turn.js";

describe("repairOpenTurnEvents", () => {
  it("returns empty when the last turn is closed", () => {
    const events: SessionEvent[] = [
      { type: "turn/start", ts: 1, turnId: "t1" },
      { type: "turn/end", ts: 2, turnId: "t1", reason: { kind: "completed" } },
    ];
    expect(repairOpenTurnEvents(events)).toEqual([]);
    expect(sessionHasOpenTurn(events)).toBe(false);
  });

  it("closes dangling turn with folded stream prefix", () => {
    const events: SessionEvent[] = [
      { type: "turn/start", ts: 1, turnId: "t1" },
      { type: "step/start", ts: 2, turnId: "t1", stepId: "s1" },
      {
        type: "assistant/chunk",
        ts: 3,
        turnId: "t1",
        stepId: "s1",
        text: "partial",
        kind: "text",
        index: 0,
      },
    ];
    const repaired = repairOpenTurnEvents(events, () => 99);
    expect(repaired.map((e) => e.type)).toEqual([
      "assistant/message",
      "step/end",
      "turn/end",
    ]);
    const msg = repaired.find((e) => e.type === "assistant/message");
    expect(msg?.type === "assistant/message" && msg.content).toBe("partial");
    expect(msg?.type === "assistant/message" && msg.interrupted).toBe(true);
    const turnEnd = repaired.find((e) => e.type === "turn/end");
    expect(turnEnd?.type === "turn/end" && turnEnd.reason).toEqual({
      kind: "interrupted",
    });
  });

  it("settles dangling tool calls before closing turn", () => {
    const events: SessionEvent[] = [
      { type: "turn/start", ts: 1, turnId: "t1" },
      { type: "step/start", ts: 2, turnId: "t1", stepId: "s1" },
      {
        type: "tool/call",
        ts: 3,
        turnId: "t1",
        stepId: "s1",
        call: { id: "c1", name: "grep", arguments: "{}" },
      },
    ];
    const repaired = repairOpenTurnEvents(events, () => 50);
    expect(repaired[0]?.type).toBe("tool/result");
    expect(repaired.at(-1)?.type).toBe("turn/end");
  });

  it("settles toolCalls folded from stream chunks before turn/end", () => {
    const events: SessionEvent[] = [
      { type: "turn/start", ts: 1, turnId: "t1" },
      { type: "step/start", ts: 2, turnId: "t1", stepId: "s1" },
      {
        type: "assistant/chunk",
        ts: 3,
        turnId: "t1",
        stepId: "s1",
        kind: "tool-call",
        index: 0,
        text: "",
        toolCallId: "c-stream",
        toolName: "echo",
        argumentsDelta: '{"q":1}',
      },
    ];
    const repaired = repairOpenTurnEvents(events, () => 77);
    expect(repaired.map((e) => e.type)).toEqual([
      "assistant/message",
      "tool/result",
      "step/end",
      "turn/end",
    ]);
    const msg = repaired.find((e) => e.type === "assistant/message");
    expect(msg?.type === "assistant/message" && msg.toolCalls).toEqual([
      { id: "c-stream", name: "echo", arguments: { q: 1 } },
    ]);
    const result = repaired.find((e) => e.type === "tool/result");
    expect(result?.type === "tool/result" && result.result.toolCallId).toBe(
      "c-stream",
    );
    expect(result?.type === "tool/result" && result.result.isError).toBe(true);
  });

  it("closes every orphan turn after a later turn completed (false-idle residue)", () => {
    const events: SessionEvent[] = [
      { type: "turn/start", ts: 1, turnId: "orphan-old" },
      { type: "step/start", ts: 2, turnId: "orphan-old", stepId: "s-old" },
      { type: "turn/start", ts: 3, turnId: "orphan-mid" },
      { type: "turn/start", ts: 4, turnId: "done" },
      {
        type: "turn/end",
        ts: 5,
        turnId: "done",
        reason: { kind: "completed" },
      },
    ];
    expect(listOpenTurnIds(events)).toEqual(["orphan-old", "orphan-mid"]);
    expect(sessionHasOpenTurn(events)).toBe(true);

    const repaired = repairOpenTurnEvents(events, () => 100);
    const ends = repaired.filter((e) => e.type === "turn/end");
    expect(ends.map((e) => (e.type === "turn/end" ? e.turnId : ""))).toEqual([
      "orphan-mid",
      "orphan-old",
    ]);
    expect(
      repaired.some(
        (e) =>
          e.type === "step/end" &&
          e.turnId === "orphan-old" &&
          e.stepId === "s-old",
      ),
    ).toBe(true);

    const merged = [...events, ...repaired];
    expect(listOpenTurnIds(merged)).toEqual([]);
    expect(sessionHasOpenTurn(merged)).toBe(false);
  });
});
