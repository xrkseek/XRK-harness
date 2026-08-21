import { describe, expect, it } from "vitest";
import {
  TOOL_ABORTED_BEFORE_DISPATCH,
  TOOL_ABORTED_BEFORE_DISPATCH_MESSAGE,
  createMemorySessionStore,
  listDanglingToolCalls,
} from "@xrkseek/core-session";
import { finalizeCancelledTurn } from "../src/cancel-finalize.js";

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
    });
  });
});
