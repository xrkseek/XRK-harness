import { describe, expect, it } from "vitest";
import {
  buildCompactionPrompt,
  createMemorySessionStore,
  deriveMessages,
  deriveMessagesUnwindowed,
  estimateMessagesTokens,
  estimateRequestTokens,
  estimateTokens,
  parseCompactionStrategy,
  resolveCompactionStrategy,
  resolveSoftBudgetCeiling,
  selectHeadRecent,
} from "../src/index.js";

describe("compaction helpers", () => {
  it("estimates tokens roughly", () => {
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcdefgh")).toBe(2);
  });

  it("counts assistant reasoning toward soft-budget message price", () => {
    const without = estimateMessagesTokens([
      { role: "assistant", content: "ok" },
    ]);
    const withReasoning = estimateMessagesTokens([
      {
        role: "assistant",
        content: "ok",
        reasoning: "r".repeat(40),
      },
    ]);
    expect(withReasoning).toBeGreaterThan(without);
    expect(withReasoning - without).toBe(estimateTokens("r".repeat(40)));
  });

  it("counts image blocks with DeepSeek V41 vision tokens", () => {
    const textOnly = estimateMessagesTokens([
      { role: "user", content: [{ type: "text", text: "hi" }] },
    ]);
    const withImage = estimateMessagesTokens([
      {
        role: "user",
        content: [
          { type: "text", text: "hi" },
          {
            type: "image",
            attachment: {
              attachmentId: "sha256:abcdef0123456789",
              mediaType: "image/png",
              bytes: 1200,
              width: 10,
              height: 10,
            },
          },
        ],
      },
    ]);
    // Tiny images scale up to the 544×544 floor → 184 vision tokens.
    expect(withImage - textOnly).toBe(184);
  });

  it("resolveSoftBudgetCeiling ignores buffer >= max (no false fail-closed)", () => {
    expect(resolveSoftBudgetCeiling(100, 20)).toBe(80);
    expect(resolveSoftBudgetCeiling(100, 100)).toBe(100);
    expect(resolveSoftBudgetCeiling(100, 200)).toBe(100);
    expect(resolveSoftBudgetCeiling(50, 0)).toBe(50);
  });

  it("parseCompactionStrategy accepts strategy family ids", () => {
    expect(parseCompactionStrategy("prune-summary")).toBe("prune-summary");
    expect(parseCompactionStrategy("prune-only")).toBe("prune-only");
    expect(parseCompactionStrategy("summary-only")).toBe("summary-only");
    expect(parseCompactionStrategy("off")).toBe("off");
    expect(parseCompactionStrategy("  prune-only  ")).toBe("prune-only");
    expect(parseCompactionStrategy("unknown")).toBeUndefined();
    expect(parseCompactionStrategy(1)).toBeUndefined();
  });

  it("resolveCompactionStrategy defaults and respects auto:false", () => {
    expect(resolveCompactionStrategy(undefined)).toBe("off");
    expect(resolveCompactionStrategy({})).toBe("prune-summary");
    expect(resolveCompactionStrategy({ strategy: "summary-only" })).toBe(
      "summary-only",
    );
    expect(resolveCompactionStrategy({ auto: false })).toBe("off");
    expect(
      resolveCompactionStrategy({ auto: false, strategy: "prune-only" }),
    ).toBe("off");
  });

  it("estimateRequestTokens adds standing tool schemas", () => {
    const messages = [{ role: "user" as const, content: "hi" }];
    const base = estimateRequestTokens({ messages });
    const withTools = estimateRequestTokens({
      messages,
      tools: [
        {
          name: "t",
          description: "d".repeat(40),
          parameters: { type: "object" },
        },
      ],
    });
    expect(withTools).toBeGreaterThan(base);
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

  it("serializes user content blocks as text", () => {
    const selected = selectHeadRecent(
      [
        {
          role: "user",
          content: [{ type: "text", text: "hello-block" }],
        },
      ],
      8_000,
    );
    expect(selected).toBeDefined();
    expect(selected!.recent).toContain("hello-block");
  });

  it("selectHeadRecent prices assistant reasoning into the keep window", () => {
    const selected = selectHeadRecent(
      [
        {
          role: "assistant",
          content: "short",
          reasoning: "think-".repeat(80),
        },
        { role: "user", content: "tail" },
      ],
      30,
    );
    expect(selected).toBeDefined();
    expect(selected!.recent).toContain("tail");
    expect(selected!.head).toContain("[Reasoning]:");
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
