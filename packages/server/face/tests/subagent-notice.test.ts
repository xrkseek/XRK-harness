import { describe, expect, it } from "vitest";
import {
  formatSubagentCompletionNotice,
  formatSubagentStopNotice,
  lastAssistantBodyText,
} from "../src/adapt/subagent-notice.js";

describe("lastAssistantBodyText", () => {
  it("returns body content and ignores reasoning on the same message", () => {
    expect(
      lastAssistantBodyText([
        {
          type: "assistant/message",
          ts: 1,
          turnId: "t1",
          stepId: "s1",
          content: "Final answer for parent.",
          reasoning: "secret chain of thought that must not leak",
        },
      ]),
    ).toBe("Final answer for parent.");
  });

  it("skips reasoning-only assistant messages", () => {
    expect(
      lastAssistantBodyText([
        {
          type: "assistant/message",
          ts: 1,
          turnId: "t1",
          stepId: "s1",
          content: "",
          reasoning: "only thinking",
        },
      ]),
    ).toBe("");
  });

  it("folds text chunks and skips reasoning chunks when message is absent", () => {
    expect(
      lastAssistantBodyText([
        {
          type: "assistant/chunk",
          ts: 1,
          turnId: "t1",
          stepId: "s1",
          text: "think hard",
          kind: "reasoning",
          index: 0,
        },
        {
          type: "assistant/chunk",
          ts: 2,
          turnId: "t1",
          stepId: "s1",
          text: "Hello ",
          kind: "text",
          index: 1,
        },
        {
          type: "assistant/chunk",
          ts: 3,
          turnId: "t1",
          stepId: "s1",
          text: "world",
          kind: "text",
          index: 2,
        },
      ]),
    ).toBe("Hello world");
  });
});

describe("formatSubagentCompletionNotice", () => {
  it("includes preview and follow-up hints", () => {
    const text = formatSubagentCompletionNotice(
      {
        parentSessionId: "parent",
        childSessionId: "child-1",
        mode: "continuable",
        label: "research",
      },
      [
        { type: "turn/start", ts: 1, turnId: "t1" },
        {
          type: "assistant/message",
          ts: 2,
          turnId: "t1",
          stepId: "s1",
          content: "Found three options.",
          reasoning: "I considered four options first",
        },
      ],
    );
    expect(text).toContain("background subagent `child-1` (research)");
    expect(text).toContain("Found three options.");
    expect(text).toContain("send_message");
    expect(text).not.toContain("I considered four options first");
  });

  it("omits preview when child has no assistant text", () => {
    const text = formatSubagentCompletionNotice(
      {
        parentSessionId: "parent",
        childSessionId: "child-2",
        mode: "continuable",
        label: "task",
      },
      [],
    );
    expect(text).toContain("finished a turn");
    expect(text).toContain("send_message");
    expect(text).not.toContain("Partial / last answer");
  });

  it("omits preview when child only produced reasoning", () => {
    const text = formatSubagentCompletionNotice(
      {
        parentSessionId: "parent",
        childSessionId: "child-3",
        mode: "continuable",
        label: "thinker",
      },
      [
        {
          type: "assistant/message",
          ts: 1,
          turnId: "t1",
          stepId: "s1",
          content: "",
          reasoning: "internal scratchpad",
        },
      ],
    );
    expect(text).not.toContain("internal scratchpad");
    expect(text).toContain("finished a turn");
    expect(text).toContain("send_message");
  });

  it("marks abnormal abort and still includes truncated preview", () => {
    const text = formatSubagentCompletionNotice(
      {
        parentSessionId: "parent",
        childSessionId: "child-4",
        mode: "continuable",
        label: "worker",
      },
      [
        {
          type: "assistant/message",
          ts: 1,
          turnId: "t1",
          stepId: "s1",
          content: "partial answer cut mid-sen",
          interrupted: true,
        },
        {
          type: "turn/end",
          ts: 2,
          turnId: "t1",
          reason: { kind: "aborted", reason: { kind: "hook", reason: "budget" } },
        },
      ],
    );
    expect(text).toContain("ended abnormally (aborted by hook: budget)");
    expect(text).toContain("partial answer cut mid-sen");
    expect(text).not.toContain("finished a turn");
  });

  it("keeps a long bound answer body instead of a 2k hard clip", () => {
    const long = "x".repeat(3500);
    const text = formatSubagentCompletionNotice(
      {
        parentSessionId: "parent",
        childSessionId: "child-5",
        mode: "continuable",
        label: "writer",
      },
      [
        {
          type: "assistant/message",
          ts: 1,
          turnId: "t1",
          stepId: "s1",
          content: long,
        },
      ],
      long,
    );
    expect(text).toContain(long);
    expect(text).not.toContain("\n…\n\nFollow up");
  });
});

describe("formatSubagentStopNotice", () => {
  const link = {
    parentSessionId: "parent",
    childSessionId: "child-9",
    mode: "continuable" as const,
    label: "worker",
  };

  it("names who stopped the child and how to resume", () => {
    const events = [
      {
        type: "step/end" as const,
        ts: 1,
        turnId: "t1",
        stepId: "s1",
      },
      {
        type: "assistant/message" as const,
        ts: 2,
        turnId: "t1",
        stepId: "s1",
        content: "draft so far",
      },
    ];
    const text = formatSubagentStopNotice(link, "user", events, "draft so far");
    expect(text).toContain("stopped by the user (Stop on the child session)");
    expect(text).toContain("Already ran: 1 step");
    expect(text).toContain("send_message");
    expect(text).toContain("do not spawn a duplicate");
    expect(formatSubagentStopNotice(link, "parent", [])).toContain(
      "interrupted by the parent (interrupt_agent)",
    );
    expect(formatSubagentStopNotice(link, "takeover", [])).toContain(
      "paused for human takeover",
    );
  });

  it("tells the parent how many automatic 继续 messages already landed", () => {
    const text = formatSubagentCompletionNotice(
      link,
      [
        {
          type: "user/message",
          ts: 1,
          turnId: "t1",
          content: "继续",
          source: { kind: "auto-continue", round: 1 },
        },
        {
          type: "user/message",
          ts: 2,
          turnId: "t1",
          content: "继续",
          source: { kind: "auto-continue", round: 2 },
        },
        {
          type: "turn/end",
          ts: 3,
          turnId: "t1",
          reason: { kind: "max-tokens" },
        },
      ],
    );
    expect(text).toContain("ended abnormally (stopped at max tokens)");
    expect(text).toContain('already sent "继续" as a user message 2 time(s)');
    expect(text).toContain('send_message(agent_id, "继续")');
  });
});
