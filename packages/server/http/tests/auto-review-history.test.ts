import { describe, expect, it } from "vitest";
import { filterAutoReviewSessionHistory } from "../src/dsh-compat/auto-review-history.js";
import type { SessionEvent } from "@xrkseek/protocol";

function base(seq: number): { seq: number; time: number; turnId: string } {
  return { seq, time: seq * 1000, turnId: "t1" };
}

describe("filterAutoReviewSessionHistory", () => {
  it("keeps human / constraint / checkpoint / fact and prior tool calls", () => {
    const events = [
      {
        type: "user/message",
        ...base(1),
        content: "Do the work",
        source: { kind: "user" },
        rpcId: "rpc-1",
      },
      {
        type: "user/message",
        ...base(2),
        content: "Always use pnpm",
        source: {
          kind: "agent-instructions",
          form: "instructions",
          changes: [{ action: "set", path: "AGENTS.md" }],
        },
      },
      {
        type: "assistant/message",
        ...base(3),
        stepId: "s1",
        content: "I will call a tool",
        reasoning: "hidden thinking",
        toolCalls: [{ id: "c-pending", name: "shell", arguments: {} }],
      },
      {
        type: "tool/call",
        ...base(4),
        stepId: "s1",
        call: { id: "c-prior", name: "read_file", arguments: { path: "a.ts" } },
      },
      {
        type: "tool/result",
        ...base(5),
        stepId: "s1",
        result: {
          toolCallId: "c-prior",
          name: "read_file",
          content: "secret tool output",
        },
      },
      {
        type: "context/compaction",
        ...base(6),
        reason: "auto",
        summary: "Earlier turns compacted",
        recent: "tail",
      },
      {
        type: "tool/call",
        ...base(7),
        stepId: "s2",
        call: { id: "c-pending", name: "shell", arguments: { command: "ls" } },
      },
      {
        type: "request/header",
        ...base(8),
        header: {
          config: { provider: "p", model: "m" },
          system: "SYSTEM MUST NOT APPEAR",
        },
      },
    ] as SessionEvent[];

    const filtered = filterAutoReviewSessionHistory(events, {
      excludeToolCallId: "c-pending",
    });

    expect(filtered.projectInstructions).toEqual([
      {
        kind: "user-message",
        role: "constraint",
        sourceKind: "agent-instructions",
        content: [{ type: "text", text: "Always use pnpm" }],
      },
    ]);

    expect(filtered.history).toEqual([
      {
        kind: "user-message",
        role: "human-instruction",
        sourceKind: "user",
        content: [{ type: "text", text: "Do the work" }],
      },
      {
        kind: "tool-call",
        role: "fact",
        mode: "native",
        name: "read_file",
        arguments: JSON.stringify({ path: "a.ts" }),
      },
      {
        kind: "user-message",
        role: "checkpoint",
        sourceKind: "compact-checkpoint",
        content: [{ type: "text", text: "Earlier turns compacted" }],
      },
    ]);

    const blob = JSON.stringify(filtered);
    expect(blob).not.toContain("I will call a tool");
    expect(blob).not.toContain("hidden thinking");
    expect(blob).not.toContain("secret tool output");
    expect(blob).not.toContain("SYSTEM MUST NOT APPEAR");
    expect(blob).not.toContain("c-pending");
  });

  it("marks direct-parent prompt seq and caps recent history", () => {
    const events: SessionEvent[] = [];
    for (let i = 1; i <= 10; i += 1) {
      events.push({
        type: "user/message",
        ...base(i),
        content: `msg-${i}`,
        source: { kind: "user" },
      } as SessionEvent);
    }
    events[0] = {
      type: "user/message",
      ...base(1),
      content: "Parent task",
      source: { kind: "user" },
    } as SessionEvent;

    const filtered = filterAutoReviewSessionHistory(events, {
      directParentPromptSeq: 1,
      maxHistoryEntries: 3,
    });
    expect(filtered.history).toHaveLength(3);
    expect(filtered.history[0]).toMatchObject({
      role: "human-instruction",
      content: [{ type: "text", text: "msg-8" }],
    });
    // seq 1 is outside the recent window after cap — parent role still works when retained
    const withParent = filterAutoReviewSessionHistory(events.slice(0, 2), {
      directParentPromptSeq: 1,
    });
    expect(withParent.history[0]).toMatchObject({
      role: "direct-parent-instruction",
      content: [{ type: "text", text: "Parent task" }],
    });
  });

  it("treats images as fact and skill-catalog as fact", () => {
    const filtered = filterAutoReviewSessionHistory([
      {
        type: "user/message",
        ...base(1),
        content: [
          { type: "text", text: "see image" },
          {
            type: "image",
            attachment: {
              attachmentId: "sha256:abc",
              mediaType: "image/png",
              bytes: 1,
              width: 1,
              height: 1,
            },
          },
        ],
        source: { kind: "user" },
      },
      {
        type: "user/message",
        ...base(2),
        content: "skill list",
        source: {
          kind: "skill-catalog",
          form: "catalog",
          entries: [{ name: "x", description: "y" }],
        },
      },
    ] as SessionEvent[]);

    expect(filtered.history.map((e) => e.role)).toEqual([
      "human-instruction",
      "fact",
      "fact",
    ]);
  });
});
