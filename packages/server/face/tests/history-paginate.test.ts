import { describe, expect, it } from "vitest";
import type { SessionEvent } from "@xrkseek/protocol";
import {
  DEFAULT_HISTORY_MAX_MESSAGES,
  dropSupersededStreamDeltas,
  estimateHistoryPageChars,
  messageGroupStartIndex,
  paginateSessionHistory,
  paginateSessionHistoryForReplay,
  trimHistoryPageToWireBudget,
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

  it("does not open a tail page on a later assistant of the same Host turn", () => {
    const events = [
      ...plainTurn("t1", "s1", "first", 2),
      ...plainTurn("t2", "s2", "second", 2),
    ];
    const tail = paginateSessionHistory(events, undefined, 1);
    expect(tail.hasMore).toBe(true);
    expect(tail.events[0]?.type).toBe("turn/start");
    expect(tail.events.some((e) => e.type === "user/message" && e.content === "second")).toBe(true);
    expect(tail.events.some((e) => e.type === "user/message" && e.content === "first")).toBe(false);
  });

  it("pulls the opener when a multi-step turn is cut on its last assistant", () => {
    const events: SessionEvent[] = [
      { type: "turn/start", ts: 1, turnId: "t1" },
      { type: "user/message", ts: 2, turnId: "t1", content: "ask" },
      { type: "step/start", ts: 3, turnId: "t1", stepId: "s1" },
      { type: "assistant/message", ts: 4, turnId: "t1", stepId: "s1", content: "tooling" },
      { type: "step/end", ts: 5, turnId: "t1", stepId: "s1" },
      { type: "step/start", ts: 6, turnId: "t1", stepId: "s2" },
      { type: "assistant/message", ts: 7, turnId: "t1", stepId: "s2", content: "done" },
      { type: "step/end", ts: 8, turnId: "t1", stepId: "s2" },
      { type: "turn/end", ts: 9, turnId: "t1", reason: { kind: "completed" } },
    ];
    const page = paginateSessionHistory(events, undefined, 1);
    expect(page.hasMore).toBe(false);
    expect(page.events[0]?.type).toBe("turn/start");
    expect(page.events.some((e) => e.type === "user/message" && e.content === "ask")).toBe(true);
    expect(page.events.filter((e) => e.type === "assistant/message")).toHaveLength(2);
  });

  it("assistant group start includes step/start and chunks", () => {
    const events = plainTurn("t1", "s1", "hi", 5);
    const assistantIdx = events.findIndex((e) => e.type === "assistant/message");
    expect(messageGroupStartIndex(events, assistantIdx)).toBe(
      events.findIndex((e) => e.type === "step/start"),
    );
  });

  it("paginateSessionHistoryForReplay drops deltas superseded by assistant/message", () => {
    const events = plainTurn("t1", "s1", "hi", 120);
    const page = paginateSessionHistoryForReplay(events, undefined, 2);
    expect(page.hasMore).toBe(false);
    expect(page.events.filter((e) => e.type === "assistant/chunk")).toHaveLength(0);
    expect(page.events.some((e) => e.type === "assistant/message")).toBe(true);
  });

  it("paginateSessionHistoryForReplay keeps open-step chunks without assistant/message", () => {
    const events: SessionEvent[] = [
      { type: "turn/start", ts: 1, turnId: "t1" },
      { type: "user/message", ts: 2, turnId: "t1", content: "hi" },
      { type: "step/start", ts: 3, turnId: "t1", stepId: "s1" },
      chunk("t1", "s1", "partial"),
    ];
    const page = paginateSessionHistoryForReplay(events, undefined, 50);
    expect(page.events.filter((e) => e.type === "assistant/chunk")).toHaveLength(1);
  });

  it("trimHistoryPageToWireBudget drops older message groups until under budget", () => {
    const bulky = "x".repeat(8_000);
    const events = [
      ...plainTurn("t1", "s1", bulky, 0),
      ...plainTurn("t2", "s2", bulky, 0),
      ...plainTurn("t3", "s3", "tail", 0),
    ];
    const page = paginateSessionHistory(events, undefined, 6);
    expect(page.hasMore).toBe(false);
    const fullChars = estimateHistoryPageChars(page.events);
    const trimmed = trimHistoryPageToWireBudget(
      page.events,
      page.startIndex,
      page.hasMore,
      Math.floor(fullChars / 2),
    );
    expect(trimmed.hasMore).toBe(true);
    expect(trimmed.startIndex).toBeGreaterThan(page.startIndex);
    expect(trimmed.events.some((e) => e.type === "user/message" && e.content === "tail")).toBe(
      true,
    );
    expect(estimateHistoryPageChars(trimmed.events)).toBeLessThanOrEqual(
      Math.floor(fullChars / 2),
    );
  });

  it("drop+trim survivors keep raw absolute seq (not renumbered 1..n)", () => {
    const events = [
      ...plainTurn("t1", "s1", "first", 80),
      ...plainTurn("t2", "s2", "second", 80),
      ...plainTurn("t3", "s3", "third", 80),
    ];
    const raw = paginateSessionHistory(events, undefined, 4);
    expect(raw.hasMore).toBe(true);
    const seqByEvent = new Map<SessionEvent, number>();
    for (let i = 0; i < raw.events.length; i++) {
      seqByEvent.set(raw.events[i]!, raw.startIndex + i + 1);
    }
    const stripped = dropSupersededStreamDeltas(raw.events);
    expect(stripped.length).toBeLessThan(raw.events.length);
    const lastKept = stripped[stripped.length - 1]!;
    expect(seqByEvent.get(lastKept)).toBe(raw.startIndex + raw.events.length);
    expect(seqByEvent.get(lastKept)!).toBeGreaterThan(stripped.length);
  });
});
