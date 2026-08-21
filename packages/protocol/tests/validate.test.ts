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

  it("parses assistant/chunk kind+index and message reasoning", () => {
    const chunk = parseSessionEvent({
      type: "assistant/chunk",
      ts: 1,
      turnId: "t",
      stepId: "s",
      text: "th",
      kind: "reasoning",
      index: 0,
    });
    expect(chunk).toMatchObject({
      type: "assistant/chunk",
      kind: "reasoning",
      index: 0,
      text: "th",
    });
    const msg = parseSessionEvent({
      type: "assistant/message",
      ts: 2,
      turnId: "t",
      stepId: "s",
      content: "ans",
      reasoning: "th",
    });
    expect(msg).toMatchObject({
      type: "assistant/message",
      content: "ans",
      reasoning: "th",
    });
  });

  it("parses assistant/message.usage", () => {
    const msg = parseSessionEvent({
      type: "assistant/message",
      ts: 2,
      turnId: "t",
      stepId: "s",
      content: "ans",
      usage: { inputTokens: 10, outputTokens: 4, reasoningTokens: 1 },
    });
    expect(msg).toMatchObject({
      type: "assistant/message",
      usage: { inputTokens: 10, outputTokens: 4, reasoningTokens: 1 },
    });
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

    const withMeta = parseSessionEvent({
      type: "tool/result",
      ts: 3,
      turnId: "t",
      stepId: "s",
      result: {
        toolCallId: "c1",
        name: "web_search",
        content: "Sources:",
        meta: { truncated: false, sources: [{ url: "https://example.com" }] },
      },
    });
    expect(withMeta).toMatchObject({
      type: "tool/result",
      result: {
        name: "web_search",
        meta: { truncated: false, sources: [{ url: "https://example.com" }] },
      },
    });
    expect(() =>
      parseSessionEvent({
        type: "tool/result",
        ts: 4,
        turnId: "t",
        stepId: "s",
        result: {
          toolCallId: "c1",
          name: "web_search",
          content: "x",
          meta: [],
        },
      }),
    ).toThrow(/meta must be a JSON object/);
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

  it("parses context/compaction.shadowedTokenCount", () => {
    const ev = parseSessionEvent({
      type: "context/compaction",
      ts: 1,
      reason: "manual",
      summary: "sum",
      recent: "",
      shadowedTokenCount: 42,
    });
    expect(ev).toMatchObject({
      type: "context/compaction",
      shadowedTokenCount: 42,
    });
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

  it("parses command/run and command/done (log-only)", () => {
    const run = parseSessionEvent({
      type: "command/run",
      ts: 1,
      commandId: "cmd_1",
      name: "echo",
      args: " hello",
      source: { kind: "user" },
    });
    expect(run).toMatchObject({
      type: "command/run",
      name: "echo",
      args: " hello",
    });
    const done = parseSessionEvent({
      type: "command/done",
      ts: 2,
      commandId: "cmd_1",
      kind: "success",
      text: "hello",
    });
    expect(done).toMatchObject({ type: "command/done", kind: "success" });
  });

  it("parses todo/write (log-only standing plan)", () => {
    const todos = parseSessionEvent({
      type: "todo/write",
      ts: 3,
      todos: [{ content: "a", status: "pending" }],
    });
    expect(todos).toEqual({
      type: "todo/write",
      ts: 3,
      todos: [{ content: "a", status: "pending" }],
    });
  });

  it("parses permission knobs (log-only)", () => {
    expect(
      parseSessionEvent({
        type: "permission/preset",
        ts: 1,
        preset: "workspace-write",
      }),
    ).toMatchObject({ type: "permission/preset", preset: "workspace-write" });
    expect(
      parseSessionEvent({
        type: "sandbox/mode",
        ts: 2,
        mode: "read-only",
      }),
    ).toMatchObject({ type: "sandbox/mode", mode: "read-only" });
    expect(
      parseSessionEvent({
        type: "approval/policy",
        ts: 3,
        policy: "never",
      }),
    ).toMatchObject({ type: "approval/policy", policy: "never" });
    expect(
      parseSessionEvent({
        type: "plan/mode",
        ts: 4,
        active: true,
      }),
    ).toMatchObject({ type: "plan/mode", active: true });
    expect(
      parseSessionEvent({
        type: "feedback/record",
        ts: 5,
        text: "the diff view is unreadable",
      }),
    ).toMatchObject({
      type: "feedback/record",
      text: "the diff view is unreadable",
    });
    expect(() =>
      parseSessionEvent({ type: "feedback/record", ts: 6, text: "  " }),
    ).toThrow(/non-empty/);

    expect(
      parseSessionEvent({
        type: "llm/retry",
        ts: 7,
        turnId: "t1",
        stepId: "s1",
        retryId: "r1",
        retry: 1,
        maxRetries: 5,
        delayMs: 1000,
        mode: "normal",
        failure: { message: "rate", code: "RATE_LIMIT", status: 429 },
        provider: "openai-compatible",
      }),
    ).toMatchObject({
      type: "llm/retry",
      retry: 1,
      failure: { code: "RATE_LIMIT" },
    });

    expect(
      parseSessionEvent({
        type: "llm/retry-started",
        ts: 8,
        turnId: "t1",
        stepId: "s1",
        retryId: "r1",
        retry: 1,
      }),
    ).toMatchObject({ type: "llm/retry-started", retry: 1 });
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
      "command/run",
      "command/done",
      "todo/write",
      "permission/preset",
      "sandbox/mode",
      "approval/policy",
      "plan/mode",
      "feedback/record",
      "request/header",
      "llm/retry",
      "llm/retry-started",
    ];
    expect(types.sort()).toEqual([...expected].sort());
    expect(sessionEventJsonSchema.$id).toContain("session-event");
  });
});
