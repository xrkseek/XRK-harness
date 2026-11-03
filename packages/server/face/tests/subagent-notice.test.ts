import { describe, expect, it } from "vitest";
import {
  describeChildOutcome,
  formatChildRouteLine,
  formatDescribedChildOutcome,
  formatSubagentCompletionNotice,
  formatSubagentStopNotice,
  formatSubagentUserPromptNotice,
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

describe("formatSubagentUserPromptNotice", () => {
  it("mirrors the human follow-up preview for the parent inbox", () => {
    const text = formatSubagentUserPromptNotice(
      {
        parentSessionId: "parent",
        childSessionId: "child-u",
        mode: "continuable",
        label: "researcher",
      },
      "  Please refine the outline.  ",
    );
    expect(text).toContain("User message to background subagent `child-u` (researcher):");
    expect(text).toContain("Please refine the outline.");
  });

  it("clips very long follow-ups", () => {
    const long = "x".repeat(900);
    const text = formatSubagentUserPromptNotice(
      {
        parentSessionId: "parent",
        childSessionId: "child-u",
        mode: "continuable",
        label: "worker",
      },
      long,
    );
    expect(text.length).toBeLessThan(long.length + 120);
    expect(text.endsWith("…")).toBe(true);
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

const errorLink = {
  parentSessionId: "parent",
  childSessionId: "child-q",
  mode: "continuable" as const,
  label: "worker",
};

function errorEvents(error: unknown) {
  return [
    {
      type: "assistant/message" as const,
      ts: 1,
      turnId: "t1",
      stepId: "s1",
      content: "half of the work",
      interrupted: true,
    },
    {
      type: "turn/end" as const,
      ts: 2,
      turnId: "t1",
      reason: { kind: "error" as const, error },
    },
  ];
}

describe("child error codes", () => {
  it("forwards a short provider code and names it in the verdict", () => {
    const events = errorEvents({ code: "QUOTA", message: "insufficient_quota" });
    const outcome = describeChildOutcome(events, 5_000);
    expect(outcome).toMatchObject({ kind: "error", code: "QUOTA" });
    expect(formatDescribedChildOutcome(outcome)).toBe(
      "ended with error (QUOTA) · last event 5s ago",
    );
    const text = formatSubagentCompletionNotice(errorLink, events);
    expect(text).toContain("Outcome: ended with error (QUOTA)");
    expect(text).toContain("half of the work");
  });

  it("omits the parenthetical when the code is not a short string", () => {
    for (const error of [
      new Error("boom"),
      { code: 429 },
      { code: "" },
      { code: "x".repeat(65) },
      "QUOTA",
      null,
    ]) {
      const outcome = describeChildOutcome(errorEvents(error), 5_000);
      expect(outcome.kind).toBe("error");
      expect(outcome.code).toBeUndefined();
      expect(formatDescribedChildOutcome(outcome)).toBe(
        "ended with error · last event 5s ago",
      );
    }
  });

  it("QUOTA tells the parent not to resend and how to reroute", () => {
    const text = formatSubagentCompletionNotice(
      errorLink,
      errorEvents({ code: "QUOTA" }),
    );
    expect(text).toContain("Do not send another prompt down it");
    expect(text).toContain("set_agent_model");
    expect(text).toContain("reasoning_effort");
    expect(text).toContain("partial answer");
    expect(text).toContain("ask_user");
    expect(text).toContain("do not spawn a duplicate worker");
  });

  it("RATE_LIMIT says the route is still alive and never suggests switching", () => {
    const text = formatSubagentCompletionNotice(
      errorLink,
      errorEvents({ code: "RATE_LIMIT" }),
    );
    expect(text).toContain("Rate limited, not dead");
    expect(text).toContain("wait and resend");
    expect(text).not.toContain("switch");
    expect(text).not.toContain("Do not send another prompt down it");
  });

  it("AUTH keeps the generic inspect-and-recover line", () => {
    const text = formatSubagentCompletionNotice(
      errorLink,
      errorEvents({ code: "AUTH" }),
    );
    expect(text).toContain(
      "Inspect with session_read / list_agents, then send_message to recover",
    );
    expect(text).not.toContain("Do not send another prompt down it");
  });

  it("keeps completed / aborted verdicts byte-identical", () => {
    expect(
      formatDescribedChildOutcome({ kind: "completed", quietMs: 5_000 }),
    ).toBe("finished · last event 5s ago");
    expect(
      formatDescribedChildOutcome({
        kind: "aborted",
        cause: "user",
        quietMs: 1_000,
      }),
    ).toBe("aborted by user · last event 1s ago");
    expect(formatDescribedChildOutcome({ kind: "aborted" })).toBe(
      "aborted (unknown source) · last event no events",
    );
    expect(
      formatDescribedChildOutcome({ kind: "blocked", quietMs: 90_000 }),
    ).toBe("blocked · last event 2m ago");
  });
});

describe("formatChildRouteLine", () => {
  it("omits effort when absent or blank", () => {
    expect(formatChildRouteLine("qoder", "qwen-max")).toBe(
      "Route: qoder/qwen-max",
    );
    expect(formatChildRouteLine("qoder", "qwen-max", "  ")).toBe(
      "Route: qoder/qwen-max",
    );
  });

  it("names the effort when set", () => {
    expect(formatChildRouteLine("qoder", "qwen-max", "max")).toBe(
      "Route: qoder/qwen-max · effort max",
    );
  });

  it("renders right under the Outcome line without touching other lines", () => {
    const events = errorEvents({ code: "QUOTA" });
    const plain = formatSubagentCompletionNotice(errorLink, events);
    const routed = formatSubagentCompletionNotice(errorLink, events, undefined, {
      provider: "qoder",
      model: "qwen-max",
      reasoningEffort: "max",
    });
    expect(routed).toContain(
      "Outcome: ended with error (QUOTA) · last event",
    );
    expect(routed).toContain("\nRoute: qoder/qwen-max · effort max\n");
    expect(routed.replace("\nRoute: qoder/qwen-max · effort max", "")).toBe(
      plain,
    );
  });
});
