import { describe, expect, it } from "vitest";
import {
  buildCompactionPrompt,
  createMemorySessionStore,
  DEFAULT_COMPACTION_HEAD_TOKENS,
  deriveMessages,
  deriveMessagesUnwindowed,
  estimateMessagesTokens,
  estimateRequestTokens,
  estimateTokens,
  parseCompactionStrategy,
  prepareCompactionPayload,
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

  it("keeps an image-bearing user turn's text in the recent tail", () => {
    const selected = selectHeadRecent(
      [
        {
          role: "user",
          content: [
            { type: "text", text: "fix-the-flaky-test" },
            {
              type: "image",
              attachment: {
                attachmentId: "sha256:pic",
                mediaType: "image/png",
                bytes: 8,
                width: 2,
                height: 2,
              },
            },
          ],
        },
      ],
      8_000,
    );
    expect(selected).toBeDefined();
    expect(selected!.recent).toContain("fix-the-flaky-test");
    expect(selected!.recent).toContain("[image attachment]");
  });
});

describe("prepareCompactionPayload head scope", () => {
  /** ~1k tokens per turn, so a 600-token keep budget always leaves a head. */
  const fat = (marker: string) => `${marker} ${"x".repeat(4_000)}`;

  function sessionWithHistory() {
    const store = createMemorySessionStore();
    const s = store.create("c-head");
    store.append(s.id, {
      type: "user/message",
      ts: 1,
      turnId: "t0",
      content: fat("ancient-history-before-first-swap"),
    });
    store.append(s.id, {
      type: "context/compaction",
      ts: 2,
      reason: "auto",
      summary: "## Objective\n- anchor",
      recent: "[User]: tail-from-the-previous-round",
    });
    store.append(s.id, {
      type: "user/message",
      ts: 3,
      turnId: "t1",
      content: fat("fresh-after-the-swap"),
    });
    store.append(s.id, {
      type: "assistant/message",
      ts: 4,
      turnId: "t1",
      stepId: "s1",
      content: "reply",
    });
    return store.get(s.id).events;
  }

  it("summarizes only what arrived since the previous swap", () => {
    const payload = prepareCompactionPayload(sessionWithHistory(), 600);
    expect(payload).toBeDefined();
    expect(payload!.prompt).toContain("fresh-after-the-swap");
    // The pre-swap turn already lives in <previous-summary>; re-feeding it
    // every round is what grew the prompt with the session, not with the gap.
    expect(payload!.prompt).not.toContain("ancient-history-before-first-swap");
    expect(payload!.prompt).toContain("anchor");
    // The previous tail was summarized *out of* the payload that produced
    // that summary, so it still owes the anchor one pass.
    expect(payload!.prompt).toContain("tail-from-the-previous-round");
  });

  it("drops nothing when there is no prior compaction", () => {
    const store = createMemorySessionStore();
    const s = store.create("c-first");
    store.append(s.id, {
      type: "user/message",
      ts: 1,
      turnId: "t0",
      content: fat("only-history"),
    });
    store.append(s.id, {
      type: "assistant/message",
      ts: 2,
      turnId: "t0",
      stepId: "s0",
      content: "first-reply",
    });
    const payload = prepareCompactionPayload(store.get(s.id).events, 600);
    expect(payload).toBeDefined();
    expect(payload!.prompt).toContain("only-history");
    expect(payload!.prompt).not.toContain("previous-summary");
  });

  it("bounds head so the summarizer input cannot grow with the session", () => {
    const store = createMemorySessionStore();
    const s = store.create("c-bound");
    for (let i = 0; i < 40; i++) {
      store.append(s.id, {
        type: "user/message",
        ts: i + 1,
        turnId: `t${i}`,
        content: fat(`block-${i} `),
      });
    }
    const payload = prepareCompactionPayload(store.get(s.id).events, 1_000);
    expect(payload).toBeDefined();
    // head cap + kept-tail slack + prompt template.
    expect(estimateTokens(payload!.prompt)).toBeLessThanOrEqual(
      DEFAULT_COMPACTION_HEAD_TOKENS + 2 * 1_000 + 2_000,
    );
    expect(payload!.prompt).toContain("older message(s) omitted");
    // Newest head block survives; the oldest is what yields. The kept tail
    // itself never reaches the prompt, so assert on the head side only.
    expect(payload!.prompt).toContain("block-38");
    expect(payload!.prompt).not.toContain("block-0 ");
  });

  it("returns undefined when there is nothing new to summarize", () => {
    const store = createMemorySessionStore();
    const s = store.create("c-empty");
    store.append(s.id, {
      type: "context/compaction",
      ts: 1,
      reason: "auto",
      summary: "## Objective\n- anchor",
      recent: "",
    });
    expect(
      prepareCompactionPayload(store.get(s.id).events, 8_000),
    ).toBeUndefined();
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

  it("describes shadowed images by id instead of re-attaching them", () => {
    const store = createMemorySessionStore();
    const s = store.create("c-vision");
    const attachment = {
      attachmentId: "sha256:pic",
      mediaType: "image/png" as const,
      bytes: 4,
      width: 1,
      height: 1,
    };
    store.append(s.id, {
      type: "user/message",
      ts: 1,
      turnId: "t0",
      content: [
        { type: "text", text: "see this" },
        { type: "image", attachment },
      ],
    });
    store.append(s.id, {
      type: "assistant/message",
      ts: 2,
      turnId: "t0",
      stepId: "s0",
      content: "ok",
    });
    store.append(s.id, {
      type: "context/compaction",
      ts: 3,
      reason: "auto",
      summary: "## Objective\n- demo",
      recent: "",
    });
    store.append(s.id, {
      type: "user/message",
      ts: 4,
      turnId: "t1",
      content: "what was in the image?",
    });

    const windowed = deriveMessages(store.get(s.id).events);
    expect(windowed[0]?.content).toContain("context compacted");
    // The pixel must NOT come back — re-attaching it charged vision tokens on
    // every turn and read as a fresh user paste.
    const withImage = windowed.find(
      (m) =>
        m.role === "user" &&
        typeof m.content !== "string" &&
        m.content.some((b) => b.type === "image"),
    );
    expect(withImage).toBeUndefined();
    const pointer = windowed.find(
      (m) => typeof m.content === "string" && m.content.includes("sha256:pic"),
    );
    expect(pointer).toBeDefined();
    expect(pointer?.content).toContain("read_image");
    expect(windowed.at(-1)).toEqual({
      role: "user",
      content: "what was in the image?",
    });
  });

  it("keeps a shadowed image turn's text out of the re-sent bytes across compactions", () => {
    const store = createMemorySessionStore();
    const s = store.create("c-vision-repeat");
    const attachment = {
      attachmentId: "sha256:only-once",
      mediaType: "image/png" as const,
      bytes: 4,
      width: 1,
      height: 1,
    };
    store.append(s.id, {
      type: "user/message",
      ts: 1,
      turnId: "t0",
      content: [
        { type: "text", text: "the one screenshot" },
        { type: "image", attachment },
      ],
    });
    for (let i = 0; i < 3; i++) {
      store.append(s.id, {
        type: "assistant/message",
        ts: 2 + i * 2,
        turnId: `t${i}`,
        stepId: `s${i}`,
        content: `answer-${i}`,
      });
      store.append(s.id, {
        type: "context/compaction",
        ts: 3 + i * 2,
        reason: "auto",
        summary: `## Objective\n- round ${i}`,
        recent: "",
      });
    }

    const windowed = deriveMessages(store.get(s.id).events);
    let imageBlocks = 0;
    for (const m of windowed) {
      if (typeof m.content === "string") continue;
      for (const b of m.content) if (b.type === "image") imageBlocks++;
    }
    expect(imageBlocks).toBe(0);
    const named = windowed.filter(
      (m) => typeof m.content === "string" && m.content.includes("sha256:only-once"),
    );
    // Exactly one pointer, no matter how many compactions followed.
    expect(named).toHaveLength(1);
  });
});
