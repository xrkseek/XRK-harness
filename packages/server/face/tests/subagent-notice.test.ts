import { describe, expect, it } from "vitest";
import {
  formatSubagentCompletionNotice,
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
    expect(text).toBe(
      "background subagent `child-2` (task) finished a turn. Follow up with send_message, interrupt_agent when done, or list_agents.",
    );
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
    expect(text).toBe(
      "background subagent `child-3` (thinker) finished a turn. Follow up with send_message, interrupt_agent when done, or list_agents.",
    );
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
