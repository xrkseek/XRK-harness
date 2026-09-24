import { describe, expect, it } from "vitest";
import { buildRolloutTraceState } from "../src/rollout-trace.js";
import type { SessionEvent } from "@xrkseek/protocol";

describe("buildRolloutTraceState", () => {
  it("emits spawn · message · tool edges for local debug", () => {
    const parentEvents: SessionEvent[] = [
      { type: "turn/start", ts: 1, turnId: "t1" },
      {
        type: "user/message",
        ts: 2,
        turnId: "t1",
        content: "spawn a helper",
      },
      {
        type: "tool/call",
        ts: 3,
        turnId: "t1",
        stepId: "s1",
        call: { id: "c1", name: "subagent", arguments: {} },
      },
      {
        type: "tool/result",
        ts: 4,
        turnId: "t1",
        stepId: "s1",
        result: {
          toolCallId: "c1",
          name: "subagent",
          content: "ok",
        },
      },
      {
        type: "assistant/message",
        ts: 5,
        turnId: "t1",
        stepId: "s2",
        content: "done",
      },
      { type: "turn/end", ts: 6, turnId: "t1", reason: "completed" },
    ];
    const childEvents: SessionEvent[] = [
      { type: "turn/start", ts: 10, turnId: "t2" },
      {
        type: "user/message",
        ts: 11,
        turnId: "t2",
        content: "child work",
      },
      { type: "turn/end", ts: 12, turnId: "t2", reason: "completed" },
    ];

    const state = buildRolloutTraceState({
      rootSessionId: "parent",
      eventsBySession: {
        parent: parentEvents,
        child: childEvents,
      },
      links: [
        {
          parentSessionId: "parent",
          childSessionId: "child",
          mode: "one-shot",
          label: "helper",
        },
      ],
    });

    expect(state.purpose).toBe("local-debug");
    expect(state.version).toBe(1);
    expect(state.counts.spawn).toBe(1);
    expect(state.counts.tool).toBeGreaterThanOrEqual(2);
    expect(state.counts.message).toBeGreaterThanOrEqual(2);
    expect(state.edges.some((e) => e.kind === "spawn")).toBe(true);
    expect(
      state.nodes.some((n) => n.kind === "tool_call" && n.toolName === "subagent"),
    ).toBe(true);
    expect(state.nodes.some((n) => n.sessionId === "child")).toBe(true);
  });

  it("stays empty-ish without events (session node only)", () => {
    const state = buildRolloutTraceState({
      rootSessionId: "solo",
      eventsBySession: { solo: [] },
    });
    expect(state.nodes).toHaveLength(1);
    expect(state.nodes[0]?.kind).toBe("session");
    expect(state.edges).toHaveLength(0);
  });
});
