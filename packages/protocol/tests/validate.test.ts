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

  it("parses user/message ContentBlock[] with image, offloaded, and file", () => {
    const ev = parseSessionEvent({
      type: "user/message",
      ts: 1,
      turnId: "t1",
      content: [
        { type: "text", text: "see" },
        {
          type: "image",
          attachment: {
            attachmentId: "sha256:abc",
            mediaType: "image/png",
            bytes: 12,
            width: 2,
            height: 2,
            originalDimensions: { width: 4, height: 4 },
          },
          offloaded: true,
        },
        {
          type: "file",
          attachment: {
            attachmentId: "sha256:def",
            name: "notes.txt",
            bytes: 3,
            mediaType: "text/plain",
          },
        },
      ],
    });
    expect(ev.type).toBe("user/message");
    if (ev.type !== "user/message") throw new Error("narrow");
    expect(Array.isArray(ev.content)).toBe(true);
    const blocks = ev.content as readonly {
      type: string;
      offloaded?: true;
    }[];
    expect(blocks.map((b) => b.type)).toEqual(["text", "image", "file"]);
    expect(blocks[1]?.offloaded).toBe(true);
  });

  it("rejects image offloaded other than true and invalid file names", () => {
    expect(() =>
      parseSessionEvent({
        type: "user/message",
        ts: 1,
        turnId: "t1",
        content: [
          {
            type: "image",
            attachment: {
              attachmentId: "a",
              mediaType: "image/png",
              bytes: 1,
              width: 1,
              height: 1,
            },
            offloaded: false,
          },
        ],
      }),
    ).toThrow(/invalid ContentBlock/);
    expect(() =>
      parseSessionEvent({
        type: "user/message",
        ts: 1,
        turnId: "t1",
        content: [
          {
            type: "file",
            attachment: {
              attachmentId: "a",
              name: "dir/notes.txt",
              bytes: 1,
            },
          },
        ],
      }),
    ).toThrow(/invalid ContentBlock/);
  });

  it("parses image/offload and rejects non-increasing indexes", () => {
    const ev = parseSessionEvent({
      type: "image/offload",
      ts: 9,
      targets: [
        { seq: 0, imageIndexes: [0, 2] },
        { seq: 3, imageIndexes: [1] },
      ],
    });
    expect(ev).toEqual({
      type: "image/offload",
      ts: 9,
      targets: [
        { seq: 0, imageIndexes: [0, 2] },
        { seq: 3, imageIndexes: [1] },
      ],
    });
    expect(() =>
      parseSessionEvent({
        type: "image/offload",
        ts: 9,
        targets: [{ seq: 0, imageIndexes: [2, 1] }],
      }),
    ).toThrow(/strictly increasing/);
    expect(() =>
      parseSessionEvent({
        type: "image/offload",
        ts: 9,
        targets: [
          { seq: 1, imageIndexes: [0] },
          { seq: 1, imageIndexes: [1] },
        ],
      }),
    ).toThrow(/duplicate target seq/);
  });

  it("parses user/message session-reference source", () => {
    const ev = parseSessionEvent({
      type: "user/message",
      ts: 3,
      turnId: "t1",
      content: "## Referenced sessions\n...",
      source: {
        kind: "session-reference",
        form: "recall",
        version: 1,
        references: [
          {
            sessionId: "src-1",
            label: "Other",
            capturedThroughSeq: 4,
            compacted: false,
            originalMessages: 2,
            retainedMessages: 2,
            omittedMessages: 0,
            omittedBytes: 0,
            truncated: false,
            inputIndex: 0,
          },
        ],
      },
    });
    expect(ev).toMatchObject({
      source: {
        kind: "session-reference",
        form: "recall",
        version: 1,
        references: [{ sessionId: "src-1", label: "Other" }],
      },
    });
  });

  it("parses user/message skill-catalog source", () => {
    const ev = parseSessionEvent({
      type: "user/message",
      ts: 1,
      turnId: "t1",
      content: "<available_skills>",
      source: {
        kind: "skill-catalog",
        form: "catalog",
        entries: [{ name: "ping", description: "Ping" }],
        digest: "abc",
        update: true,
      },
    });
    expect(ev).toMatchObject({
      type: "user/message",
      source: {
        kind: "skill-catalog",
        form: "catalog",
        entries: [{ name: "ping", description: "Ping" }],
        digest: "abc",
        update: true,
      },
    });
  });

  it("parses user/message agent-instructions source", () => {
    const ev = parseSessionEvent({
      type: "user/message",
      ts: 2,
      turnId: "t1",
      content: "## Assistant\nhello",
      source: {
        kind: "agent-instructions",
        form: "instructions",
        changes: [{ action: "set", path: "assistant.md" }],
        budgetTruncations: [
          { section: "rules", originalChars: 100, keptChars: 40 },
        ],
      },
    });
    expect(ev).toMatchObject({
      source: {
        kind: "agent-instructions",
        form: "instructions",
        changes: [{ action: "set", path: "assistant.md" }],
        budgetTruncations: [
          { section: "rules", originalChars: 100, keptChars: 40 },
        ],
      },
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

  it("parses workspace/changes (log-only turn file card)", () => {
    const summary = {
      turnId: "t1",
      cwd: "/work",
      files: [
        { path: "a.ts", display: "a.ts", added: 2, deleted: 1 },
      ],
      total: 1,
      added: 2,
      deleted: 1,
    };
    const ev = parseSessionEvent({
      type: "workspace/changes",
      ts: 9,
      turnId: "t1",
      summary,
    });
    expect(ev).toEqual({
      type: "workspace/changes",
      ts: 9,
      turnId: "t1",
      summary,
    });
    expect(() =>
      parseSessionEvent({
        type: "workspace/changes",
        ts: 9,
        turnId: "t1",
        summary: { ...summary, turnId: "other" },
      }),
    ).toThrow(/turnId/);
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
    expect(
      parseSessionEvent({ type: "feedback/record", ts: 6, text: "  " }),
    ).toEqual({ type: "feedback/record", ts: 6 });
    expect(
      parseSessionEvent({
        type: "feedback/record",
        ts: 6,
        category: "task-result",
        sliceId: "slice-1",
      }),
    ).toMatchObject({
      type: "feedback/record",
      category: "task-result",
      sliceId: "slice-1",
    });
    expect(() =>
      parseSessionEvent({
        type: "feedback/record",
        ts: 6,
        category: "not-real",
      }),
    ).toThrow(/category/);

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
      "image/offload",
      "workspace/changes",
    ];
    expect(types.sort()).toEqual([...expected].sort());
    expect(sessionEventJsonSchema.$id).toContain("session-event");
  });

  it("messageContentSchema covers image offloaded + file blocks", () => {
    const userMsg = sessionEventJsonSchema.oneOf.find(
      (s) => (s.properties.type as { const: string }).const === "user/message",
    );
    expect(userMsg).toBeDefined();
    const content = userMsg!.properties.content as {
      oneOf: Array<{
        type?: string;
        items?: {
          oneOf: Array<{
            properties: {
              type: { const: string };
              offloaded?: { const: true };
            };
          }>;
        };
      }>;
    };
    const blocks = content.oneOf.find((b) => b.type === "array")?.items?.oneOf;
    expect(blocks?.map((b) => b.properties.type.const).sort()).toEqual([
      "file",
      "image",
      "text",
    ]);
    const image = blocks?.find((b) => b.properties.type.const === "image");
    expect(image?.properties.offloaded).toEqual({ const: true });
  });
});
