import { describe, expect, it } from "vitest";
import { formatSubagentCompletionNotice } from "../src/adapt/subagent-notice.js";

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
        },
      ],
    );
    expect(text).toContain("background subagent `child-1` (research)");
    expect(text).toContain("Found three options.");
    expect(text).toContain("send_message");
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
});
