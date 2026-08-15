import { describe, expect, it } from "vitest";
import type { SessionEvent } from "@xrkseek/protocol";
import {
  TOOL_INTERRUPTED_MESSAGE,
  ToolSettlementError,
  assertToolCallsSettled,
  createMemorySessionStore,
  deriveMessages,
  listDanglingToolCalls,
  settleDanglingTools,
} from "../src/index.js";

describe("listDanglingToolCalls", () => {
  it("detects tool/call without result", () => {
    const events: SessionEvent[] = [
      {
        type: "tool/call",
        ts: 1,
        turnId: "t",
        stepId: "s",
        call: { id: "c1", name: "echo", arguments: {} },
      },
    ];
    expect(listDanglingToolCalls(events)).toHaveLength(1);
    expect(listDanglingToolCalls(events)[0]?.call.id).toBe("c1");
  });

  it("clears when result arrives", () => {
    const events: SessionEvent[] = [
      {
        type: "tool/call",
        ts: 1,
        turnId: "t",
        stepId: "s",
        call: { id: "c1", name: "echo", arguments: {} },
      },
      {
        type: "tool/result",
        ts: 2,
        turnId: "t",
        stepId: "s",
        result: {
          toolCallId: "c1",
          name: "echo",
          content: "ok",
        },
      },
    ];
    expect(listDanglingToolCalls(events)).toHaveLength(0);
  });

  it("reopens same call id across turns", () => {
    const events: SessionEvent[] = [
      {
        type: "tool/call",
        ts: 1,
        turnId: "t1",
        stepId: "s1",
        call: { id: "c1", name: "echo", arguments: { n: 1 } },
      },
      {
        type: "tool/result",
        ts: 2,
        turnId: "t1",
        stepId: "s1",
        result: { toolCallId: "c1", name: "echo", content: "1" },
      },
      {
        type: "tool/call",
        ts: 3,
        turnId: "t2",
        stepId: "s2",
        call: { id: "c1", name: "echo", arguments: { n: 2 } },
      },
    ];
    const d = listDanglingToolCalls(events);
    expect(d).toHaveLength(1);
    expect(d[0]?.turnId).toBe("t2");
    expect(d[0]?.call.arguments).toEqual({ n: 2 });
  });

  it("opens from assistant.toolCalls when tool/call missing", () => {
    const events: SessionEvent[] = [
      {
        type: "assistant/message",
        ts: 1,
        turnId: "t",
        stepId: "s",
        content: "",
        toolCalls: [{ id: "c9", name: "x", arguments: {} }],
      },
    ];
    expect(listDanglingToolCalls(events)[0]?.source).toBe("assistant/message");
  });
});

describe("settleDanglingTools", () => {
  it("appends interrupted results and is idempotent", () => {
    const store = createMemorySessionStore();
    const s = store.create("dangle");
    store.append(s.id, {
      type: "tool/call",
      ts: 1,
      turnId: "t",
      stepId: "s",
      call: { id: "c1", name: "boom", arguments: {} },
    });

    const first = settleDanglingTools(store, s.id, {
      now: () => 10,
    });
    expect(first.settled).toHaveLength(1);
    assertToolCallsSettled(store.get(s.id).events);

    const second = settleDanglingTools(store, s.id);
    expect(second.settled).toHaveLength(0);

    const msgs = deriveMessages(store.get(s.id).events);
    expect(msgs).toEqual([
      {
        role: "tool",
        content: TOOL_INTERRUPTED_MESSAGE,
        toolCallId: "c1",
        name: "boom",
        isError: true,
      },
    ]);
  });

  it("assertToolCallsSettled throws when open", () => {
    const events: SessionEvent[] = [
      {
        type: "tool/call",
        ts: 1,
        turnId: "t",
        stepId: "s",
        call: { id: "c1", name: "echo", arguments: {} },
      },
    ];
    expect(() => assertToolCallsSettled(events)).toThrow(ToolSettlementError);
  });
});
