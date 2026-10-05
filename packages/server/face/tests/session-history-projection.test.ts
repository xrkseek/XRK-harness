import { describe, expect, it } from "vitest";
import { createMemorySessionStore, newSession } from "@xrkseek/core-session";
import { dispatchFaceMethod } from "../src/dispatch.js";
import {
  createBareFaceRuntime,
  unusedAgentResolve,
} from "./helpers/bare-runtime.js";

type HistoryValue = {
  events: { event: { seq: number } }[];
  hasMore: boolean;
  projections?: { values: Record<string, unknown> };
};

describe("session.history projections", () => {
  it("tail page carries contextTimeline; loadOlder omits the whole block", async () => {
    const store = createMemorySessionStore();
    const runtime = createBareFaceRuntime({ store, resolveAgent: unusedAgentResolve() });
    const session = newSession(store);
    store.append(session.id, {
      type: "turn/start",
      ts: 1,
      turnId: "t1",
    });
    store.append(session.id, {
      type: "user/message",
      ts: 2,
      turnId: "t1",
      content: "hello",
    });
    store.append(session.id, {
      type: "request/header",
      ts: 3,
      turnId: "t1",
      reason: "initial",
      header: {
        config: { provider: "deepseek", model: "deepseek-chat" },
        system: "You are helpful.",
        tools: [],
      },
    });

    const tail = await dispatchFaceMethod(runtime, "session.history", "tail", {
      sessionId: session.id,
      maxMessages: 1,
    });
    expect(tail.result.ok).toBe(true);
    if (!tail.result.ok) throw new Error("tail history failed");
    const tailValue = tail.result.value as HistoryValue;
    expect(tailValue.projections?.values.contextTimeline).toBeDefined();
    expect(tailValue.projections?.values.contextHeaders).toBeDefined();
    expect(tailValue.projections?.values.turnOutline).toEqual([
      { turn: 1, seq: 1, round: 1, prompt: "hello", response: "" },
    ]);

    const firstSeq = tailValue.events[0]?.event.seq;
    expect(firstSeq).toBeGreaterThan(0);

    const older = await dispatchFaceMethod(runtime, "session.history", "older", {
      sessionId: session.id,
      beforeSeq: firstSeq,
      maxMessages: 10,
    });
    expect(older.result.ok).toBe(true);
    if (!older.result.ok) throw new Error("older history failed");
    const olderValue = older.result.value as HistoryValue;
    expect(olderValue.projections).toBeUndefined();
  });

  it("keeps whole-log turn numbers when the tail page is wired before loadOlder", async () => {
    const store = createMemorySessionStore();
    const runtime = createBareFaceRuntime({ store, resolveAgent: unusedAgentResolve() });
    const session = newSession(store);
    for (let i = 1; i <= 5; i++) {
      const turnId = `t${String(i)}`;
      store.append(session.id, { type: "turn/start", ts: i * 10, turnId });
      store.append(session.id, {
        type: "user/message",
        ts: i * 10 + 1,
        turnId,
        content: `ask ${String(i)}`,
      });
      store.append(session.id, {
        type: "assistant/message",
        ts: i * 10 + 2,
        turnId,
        stepId: `s${String(i)}`,
        content: `reply ${String(i)}`,
      });
      store.append(session.id, {
        type: "turn/end",
        ts: i * 10 + 3,
        turnId,
        reason: { kind: "completed" },
      });
    }

    const tail = await dispatchFaceMethod(runtime, "session.history", "tail", {
      sessionId: session.id,
      maxMessages: 2,
    });
    expect(tail.result.ok).toBe(true);
    if (!tail.result.ok) throw new Error("tail history failed");
    const tailValue = tail.result.value as {
      events: { event: { type: string; data?: { turn?: number; content?: unknown } } }[];
      hasMore: boolean;
    };
    expect(tailValue.hasMore).toBe(true);
    const tailStart = tailValue.events.find((row) => row.event.type === "turn/start");
    expect(tailStart?.event.data?.turn).toBe(5);

    const outline = (
      (tail.result.value as HistoryValue).projections?.values.turnOutline as
        | { turn: number; round: number; prompt: string }[]
        | undefined
    );
    expect(outline?.[0]).toMatchObject({ turn: 1, round: 1, prompt: "ask 1" });
    expect(outline?.[4]).toMatchObject({ turn: 5, round: 5, prompt: "ask 5" });

    let beforeSeq = tailValue.events[0]?.event.seq as number;
    let sawFirst = false;
    for (let page = 0; page < 8 && !sawFirst; page++) {
      const older = await dispatchFaceMethod(runtime, "session.history", "older", {
        sessionId: session.id,
        beforeSeq,
        maxMessages: 2,
      });
      expect(older.result.ok).toBe(true);
      if (!older.result.ok) throw new Error("older history failed");
      const olderValue = older.result.value as {
        events: { event: { seq: number; type: string; data?: { turn?: number; content?: unknown } } }[];
        hasMore: boolean;
      };
      const firstAsk = olderValue.events.findIndex((row) => {
        if (row.event.type !== "user/message") return false;
        return JSON.stringify(row.event.data?.content ?? "").includes("ask 1");
      });
      if (firstAsk >= 0) {
        const start = olderValue.events
          .slice(0, firstAsk + 1)
          .findLast((row) => row.event.type === "turn/start");
        expect(start?.event.data?.turn).toBe(1);
        sawFirst = true;
        break;
      }
      beforeSeq = olderValue.events[0]?.event.seq ?? beforeSeq;
      if (!olderValue.hasMore) break;
    }
    expect(sawFirst).toBe(true);
  });
});
