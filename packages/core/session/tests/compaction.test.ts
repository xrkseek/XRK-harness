import { describe, expect, it } from "vitest";
import {
  buildCompactionPrompt,
  createMemorySessionStore,
  deriveMessages,
  deriveMessagesUnwindowed,
  estimateTokens,
  selectHeadRecent,
} from "../src/index.js";

describe("compaction helpers", () => {
  it("estimates tokens roughly", () => {
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcdefgh")).toBe(2);
  });

  it("keeps recent from the end within budget", () => {
    const msgs = [
      { role: "user" as const, content: "aaaa".repeat(100) },
      { role: "assistant" as const, content: "bbbb".repeat(100) },
      { role: "user" as const, content: "short" },
    ];
    const selected = selectHeadRecent(msgs, 20);
    expect(selected).toBeDefined();
    expect(selected!.recent).toContain("short");
    expect(selected!.head.length).toBeGreaterThan(0);
  });

  it("buildCompactionPrompt includes template", () => {
    const p = buildCompactionPrompt({ head: "history" });
    expect(p).toContain("## Objective");
    expect(p).toContain("history");
  });
});

describe("deriveMessages compaction window", () => {
  it("replaces pre-compaction history with summary projection", () => {
    const store = createMemorySessionStore();
    const s = store.create("c1");
    store.append(s.id, {
      type: "user/message",
      ts: 1,
      turnId: "t0",
      content: "old-1",
    });
    store.append(s.id, {
      type: "assistant/message",
      ts: 2,
      turnId: "t0",
      stepId: "s0",
      content: "old-a",
    });
    store.append(s.id, {
      type: "context/compaction",
      ts: 3,
      reason: "auto",
      summary: "## Objective\n- demo",
      recent: "[User]: keep-me",
    });
    store.append(s.id, {
      type: "user/message",
      ts: 4,
      turnId: "t1",
      content: "new",
    });

    const events = store.get(s.id).events;
    expect(deriveMessagesUnwindowed(events).map((m) => m.content)).toEqual([
      "old-1",
      "old-a",
      "new",
    ]);
    const windowed = deriveMessages(events);
    expect(windowed[0]?.content).toContain("context compacted");
    expect(windowed[0]?.content).toContain("## Objective");
    expect(windowed[0]?.content).toContain("keep-me");
    expect(windowed[1]).toEqual({ role: "user", content: "new" });
    // full log still intact
    expect(events.filter((e) => e.type === "user/message")).toHaveLength(2);
  });
});
