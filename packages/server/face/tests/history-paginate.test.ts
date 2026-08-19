import { describe, expect, it } from "vitest";
import type { SessionEvent } from "@xrkseek/protocol";
import {
  DEFAULT_HISTORY_MAX_MESSAGES,
  messageGroupStartIndex,
  paginateSessionHistory,
} from "../src/adapt/history-paginate.js";

function chunk(
  turnId: string,
  stepId: string,
  text: string,
  kind: "text" | "reasoning" = "text",
): SessionEvent {
  return {
    type: "assistant/chunk",
    ts: 1,
    turnId,
    stepId,
    text,
    kind,
  };
}

function plainTurn(
  turnId: string,
  stepId: string,
  userText: string,
  chunks: number,
): SessionEvent[] {
  const events: SessionEvent[] = [
    { type: "turn/start", ts: 1, turnId },
    { type: "user/message", ts: 2, turnId, content: userText },
    { type: "step/start", ts: 3, turnId, stepId },
  ];
  for (let i = 0; i < chunks; i++) {
    events.push(chunk(turnId, stepId, `t${i}`, i % 2 === 0 ? "reasoning" : "text"));
  }
  events.push(
    {
      type: "assistant/message",
      ts: 4,
      turnId,
      stepId,
      content: "done",
    },
    { type: "step/end", ts: 5, turnId, stepId },
    { type: "turn/end", ts: 6, turnId, reason: { kind: "completed" } },
  );
  return events;
}

describe("Face history message-boundary pagination (DSH parity)", () => {
  it("defaults to 50 messages per page", () => {
    expect(DEFAULT_HISTORY_MAX_MESSAGES).toBe(50);
  });

  it("one streamed turn with many chunks counts as two transcript messages", () => {
    const events = plainTurn("t1", "s1", "hi", 120);
    const page = paginateSessionHistory(events, undefined, 2);
    expect(page.hasMore).toBe(false);
    expect(page.events.length).toBe(events.length);
    expect(page.events[0]?.type).toBe("turn/start");
    expect(page.events.filter((e) => e.type === "assistant/chunk").length).toBe(120);
  });

  it("pages backwards by message count, not raw event count", () => {
    const events = [
      ...plainTurn("t1", "s1", "first", 80),
      ...plainTurn("t2", "s2", "second", 80),
    ];
    const tail = paginateSessionHistory(events, undefined, 2);
    expect(tail.hasMore).toBe(true);
    expect(tail.events.some((e) => e.type === "user/message" && e.content === "second")).toBe(true);
    expect(tail.events.some((e) => e.type === "user/message" && e.content === "first")).toBe(false);

    const firstSeq = tail.events[0];
    const idx = events.indexOf(firstSeq as SessionEvent);
    const beforeSeq = idx >= 0 ? idx + 1 : undefined;
    const older = paginateSessionHistory(events, beforeSeq, 2);
    expect(older.hasMore).toBe(false);
    expect(older.events.some((e) => e.type === "user/message" && e.content === "first")).toBe(true);
  });

  it("assistant group start includes step/start and chunks", () => {
    const events = plainTurn("t1", "s1", "hi", 5);
    const assistantIdx = events.findIndex((e) => e.type === "assistant/message");
    expect(messageGroupStartIndex(events, assistantIdx)).toBe(
      events.findIndex((e) => e.type === "step/start"),
    );
  });
});
