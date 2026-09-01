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
      { turn: 1, seq: 1, prompt: "hello", response: "" },
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
});
