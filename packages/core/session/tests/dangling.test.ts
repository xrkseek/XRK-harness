import {
  TOOL_ABORTED_BEFORE_DISPATCH,
  TOOL_ABORTED_BEFORE_DISPATCH_MESSAGE,
  TOOL_OUTCOME_UNKNOWN,
  TOOL_OUTCOME_UNKNOWN_MESSAGE,
  TOOL_NOT_STARTED,
  TOOL_NOT_STARTED_MESSAGE,
  assertAssistantToolCallAdjacency,
  assertToolCallsSettled,
  createMemorySessionStore,
  deriveMessages,
  listDanglingToolCalls,
  settleDanglingTools,
} from "../src/index.js";
import type { SessionEvent } from "@xrkseek/protocol";
import { describe, expect, it } from "vitest";

describe("listDanglingToolCalls", () => {
  it("finds tool/call without result", () => {
    const events: SessionEvent[] = [
      {
        type: "tool/call",
        ts: 1,
        turnId: "t",
        stepId: "s",
        call: { id: "c1", name: "echo", arguments: {} },
      },
    ];
    expect(listDanglingToolCalls(events)).toEqual([
      {
        call: { id: "c1", name: "echo", arguments: {} },
        turnId: "t",
        stepId: "s",
        openedAt: 0,
        source: "tool/call",
      },
    ]);
  });

  it("clears after tool/result", () => {
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
    expect(listDanglingToolCalls(events)).toEqual([]);
  });

  it("treats assistant toolCalls without tool/call as dangling", () => {
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
  it("appends outcome-unknown for recorded tool/call and is idempotent", () => {
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

    const resultEv = store.get(s.id).events.find((e) => e.type === "tool/result");
    expect(resultEv?.type === "tool/result" && resultEv.result.error).toEqual({
      name: "ToolOutcomeUnknownError",
      code: TOOL_OUTCOME_UNKNOWN,
    });

    const msgs = deriveMessages(store.get(s.id).events);
    expect(msgs).toEqual([
      {
        role: "tool",
        content: TOOL_OUTCOME_UNKNOWN_MESSAGE,
        toolCallId: "c1",
        name: "boom",
        isError: true,
      },
    ]);
  });

  it("uses TOOL_NOT_STARTED when only assistant named the call", () => {
    const store = createMemorySessionStore();
    const s = store.create("not-started");
    store.append(s.id, {
      type: "assistant/message",
      ts: 1,
      turnId: "t",
      stepId: "s",
      content: "",
      toolCalls: [{ id: "c2", name: "x", arguments: {} }],
    });
    settleDanglingTools(store, s.id, { now: () => 2 });
    const resultEv = store.get(s.id).events.find((e) => e.type === "tool/result");
    expect(resultEv?.type === "tool/result" && resultEv.result).toMatchObject({
      content: TOOL_NOT_STARTED_MESSAGE,
      isError: true,
      error: { code: TOOL_NOT_STARTED },
    });
  });

  it("uses ABORTED_BEFORE_DISPATCH when kind is aborted-before-dispatch", () => {
    const store = createMemorySessionStore();
    const s = store.create("abort");
    store.append(s.id, {
      type: "tool/call",
      ts: 1,
      turnId: "t",
      stepId: "s",
      call: { id: "c3", name: "x", arguments: {} },
    });
    settleDanglingTools(store, s.id, {
      now: () => 3,
      kind: "aborted-before-dispatch",
    });
    const resultEv = store.get(s.id).events.find((e) => e.type === "tool/result");
    expect(resultEv?.type === "tool/result" && resultEv.result).toMatchObject({
      content: TOOL_ABORTED_BEFORE_DISPATCH_MESSAGE,
      isError: true,
      error: { name: "AbortError", code: TOOL_ABORTED_BEFORE_DISPATCH },
    });
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
    expect(() => assertToolCallsSettled(events)).toThrow(/unsettled/);
  });
});

describe("assertAssistantToolCallAdjacency", () => {
  it("passes settled assistant→tool→assistant", () => {
    assertAssistantToolCallAdjacency([
      { role: "user", content: "hi" },
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "c1", name: "echo", arguments: {} }],
      },
      { role: "tool", content: "ok", toolCallId: "c1" },
      { role: "assistant", content: "done" },
    ]);
  });

  it("throws when trailing assistant tool_calls lack tool results", () => {
    expect(() =>
      assertAssistantToolCallAdjacency([
        {
          role: "assistant",
          content: "",
          toolCalls: [{ id: "c1", name: "echo", arguments: {} }],
        },
      ]),
    ).toThrow(/pending: c1/);
  });

  it("throws on orphan tool messages and unexpected toolCallId", () => {
    expect(() =>
      assertAssistantToolCallAdjacency([
        { role: "tool", content: "x", toolCallId: "orphan" },
      ]),
    ).toThrow(/orphan tool message/);
    expect(() =>
      assertAssistantToolCallAdjacency([
        {
          role: "assistant",
          content: "",
          toolCalls: [{ id: "c1", name: "echo", arguments: {} }],
        },
        { role: "tool", content: "x", toolCallId: "other" },
      ]),
    ).toThrow(/unexpected tool result id other/);
  });

  it("throws on duplicate assistant(toolCalls) even when ids later settle", () => {
    // Pre-0.2.1 / eviction-repair corruption shape: settlement-by-id can pass.
    const messages = [
      { role: "user" as const, content: "hi" },
      {
        role: "assistant" as const,
        content: "",
        toolCalls: [{ id: "c1", name: "echo", arguments: {} }],
      },
      {
        role: "assistant" as const,
        content: "",
        toolCalls: [{ id: "c1", name: "echo", arguments: {} }],
      },
      { role: "tool" as const, content: "ok", toolCallId: "c1" },
    ];
    expect(() => assertAssistantToolCallAdjacency(messages)).toThrow(
      /tool_calls must be followed/,
    );
  });

  it("detects the corrupt log that settle-by-id misses", () => {
    const events: SessionEvent[] = [
      {
        type: "user/message",
        ts: 1,
        turnId: "t",
        content: "hi",
      },
      {
        type: "assistant/message",
        ts: 2,
        turnId: "t",
        stepId: "s1",
        content: "",
        toolCalls: [{ id: "c1", name: "echo", arguments: {} }],
        interrupted: true,
      },
      {
        type: "assistant/message",
        ts: 3,
        turnId: "t",
        stepId: "s2",
        content: "",
        toolCalls: [{ id: "c1", name: "echo", arguments: {} }],
      },
      {
        type: "tool/result",
        ts: 4,
        turnId: "t",
        stepId: "s2",
        result: {
          toolCallId: "c1",
          name: "echo",
          content: "ok",
        },
      },
    ];
    expect(() => assertToolCallsSettled(events)).not.toThrow();
    expect(() =>
      assertAssistantToolCallAdjacency(deriveMessages(events)),
    ).toThrow(/tool_calls must be followed/);
  });
});
