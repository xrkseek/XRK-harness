import { describe, expect, it } from "vitest";
import {
  assertSessionEvent,
  isSessionEvent,
  isValidSessionEvent,
  parseSessionEvent,
  sessionEventJsonSchema,
  SessionEventParseError,
  type SessionEvent,
} from "../src/index.js";

describe("parseSessionEvent", () => {
  it("parses user/message strictly", () => {
    const ev = parseSessionEvent({
      type: "user/message",
      ts: 1,
      turnId: "t1",
      content: "hi",
    });
    expect(ev).toEqual({
      type: "user/message",
      ts: 1,
      turnId: "t1",
      content: "hi",
    });
  });

  it("rejects user/message missing content", () => {
    expect(() =>
      parseSessionEvent({ type: "user/message", ts: 1, turnId: "t" }),
    ).toThrow(SessionEventParseError);
    expect(
      isValidSessionEvent({ type: "user/message", ts: 1, turnId: "t" }),
    ).toBe(false);
    // loose gate still true
    expect(isSessionEvent({ type: "user/message", ts: 1 })).toBe(true);
  });

  it("parses tool/call and tool/result", () => {
    const call = parseSessionEvent({
      type: "tool/call",
      ts: 1,
      turnId: "t",
      stepId: "s",
      call: { id: "c1", name: "echo", arguments: { x: 1 } },
    });
    expect(call.type).toBe("tool/call");
    const result = parseSessionEvent({
      type: "tool/result",
      ts: 2,
      turnId: "t",
      stepId: "s",
      result: {
        toolCallId: "c1",
        name: "echo",
        content: "ok",
        isError: true,
      },
    });
    expect(result.type).toBe("tool/result");
    if (result.type === "tool/result") {
      expect(result.result.isError).toBe(true);
    }
  });

  it("parses prompt/admitted delivery", () => {
    expect(
      parseSessionEvent({
        type: "prompt/admitted",
        ts: 1,
        admitId: "a",
        content: "x",
        delivery: "steer",
      }),
    ).toMatchObject({ delivery: "steer" });
    expect(() =>
      parseSessionEvent({
        type: "prompt/admitted",
        ts: 1,
        admitId: "a",
        content: "x",
        delivery: "asap",
      }),
    ).toThrow(/delivery/);
  });

  it("parses safety/notice and rejects bad kind", () => {
    const ok = assertSessionEvent({
      type: "safety/notice",
      ts: 1,
      turnId: "t",
      kind: "loop_soft",
      content: "slow",
    });
    expect(ok.type).toBe("safety/notice");
    expect(() =>
      parseSessionEvent({
        type: "safety/notice",
        ts: 1,
        turnId: "t",
        kind: "nope",
        content: "x",
      }),
    ).toThrow(/kind/);
  });

  it("parses context/compaction", () => {
    const ev = parseSessionEvent({
      type: "context/compaction",
      ts: 1,
      reason: "auto",
      summary: "sum",
      recent: "tail",
    });
    expect(ev.type).toBe("context/compaction");
  });

  it("parses session/title (log-only)", () => {
    const ev = parseSessionEvent({
      type: "session/title",
      ts: 1,
      title: "Hello world",
      source: { kind: "user" },
    });
    expect(ev.type).toBe("session/title");
    if (ev.type === "session/title") {
      expect(ev.source.kind).toBe("user");
    }
  });

  it("parses approval/asked and approval/decided", () => {
    const asked = parseSessionEvent({
      type: "approval/asked",
      ts: 1,
      approvalId: "apr_1",
      toolCallId: "c1",
      toolName: "bash",
      reason: "policy ask",
      argsSummary: '{"cmd":"ls"}',
    });
    expect(asked.type).toBe("approval/asked");
    const decided = parseSessionEvent({
      type: "approval/decided",
      ts: 2,
      approvalId: "apr_1",
      decision: "allow",
      source: "user",
    });
    expect(decided.type).toBe("approval/decided");
  });
});

describe("sessionEventJsonSchema", () => {
  it("covers all session event types", () => {
    const types = sessionEventJsonSchema.oneOf.map(
      (s) => (s.properties.type as { const: string }).const,
    );
    const expected: SessionEvent["type"][] = [
      "turn/start",
      "turn/end",
      "step/start",
      "step/end",
      "user/message",
      "assistant/chunk",
      "assistant/message",
      "tool/call",
      "tool/result",
      "prompt/admitted",
      "prompt/promoted",
      "prompt/withdrawn",
      "safety/notice",
      "context/compaction",
      "session/title",
      "approval/asked",
      "approval/decided",
    ];
    expect(types.sort()).toEqual([...expected].sort());
    expect(sessionEventJsonSchema.$id).toContain("session-event");
  });
});
