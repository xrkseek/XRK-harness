import { describe, expect, it } from "vitest";
import {
  TOOL_ABORTED_BEFORE_DISPATCH,
  TOOL_ABORTED_BEFORE_DISPATCH_MESSAGE,
  createMemorySessionStore,
  listDanglingToolCalls,
} from "@xrkseek/core-session";
import {
  finalizeCancelledTurn,
  foldStepStreamChunks,
} from "../src/cancel-finalize.js";

describe("finalizeCancelledTurn (DSH abort settle)", () => {
  it("settles open tool/call as ABORTED_BEFORE_DISPATCH", () => {
    const store = createMemorySessionStore();
    const session = store.create("abort-settle");
    store.append(session.id, {
      type: "tool/call",
      ts: 1,
      turnId: "t1",
      stepId: "s1",
      call: { id: "c1", name: "echo", arguments: {} },
    });
    expect(listDanglingToolCalls(store.get(session.id).events)).toHaveLength(1);

    finalizeCancelledTurn({
      store,
      sessionId: session.id,
      turnId: "t1",
      stepId: "s1",
      now: () => 10,
      cancelCause: { kind: "user" },
    });

    expect(listDanglingToolCalls(store.get(session.id).events)).toHaveLength(0);
    const result = store
      .get(session.id)
      .events.find((e) => e.type === "tool/result");
    expect(result?.type === "tool/result" && result.result).toMatchObject({
      content: TOOL_ABORTED_BEFORE_DISPATCH_MESSAGE,
      isError: true,
      error: { name: "AbortError", code: TOOL_ABORTED_BEFORE_DISPATCH },
    });
    const turnEnd = store
      .get(session.id)
      .events.find((e) => e.type === "turn/end");
    expect(turnEnd?.type === "turn/end" && turnEnd.reason).toEqual({
      kind: "aborted",
      reason: { kind: "user" },
    });
  });

  it("folds only stream chunks after the latest in-step llm/retry", () => {
    const events = [
      {
        type: "assistant/chunk" as const,
        ts: 1,
        turnId: "t1",
        stepId: "s1",
        text: "discard-me",
        kind: "text" as const,
        index: 0,
      },
      {
        type: "llm/retry" as const,
        ts: 2,
        turnId: "t1",
        stepId: "s1",
        retryId: "r1",
        retry: 1,
        maxRetries: 2,
        delayMs: 0,
        mode: "normal" as const,
        failure: { message: "empty", code: "EMPTY_RESPONSE" },
      },
      {
        type: "assistant/chunk" as const,
        ts: 3,
        turnId: "t1",
        stepId: "s1",
        text: "keep-me",
        kind: "text" as const,
        index: 0,
      },
      {
        type: "assistant/chunk" as const,
        ts: 4,
        turnId: "t1",
        stepId: "s1",
        text: " and-more",
        kind: "reasoning" as const,
        index: 0,
      },
    ];
    expect(foldStepStreamChunks(events, "t1", "s1")).toEqual({
      content: "keep-me",
      reasoning: " and-more",
      toolCalls: [],
    });
  });
});
