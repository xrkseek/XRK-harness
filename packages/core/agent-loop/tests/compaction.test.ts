import { describe, expect, it } from "vitest";
import {
  createMemorySessionStore,
  deriveMessages,
  priceCurrentSurfaceWindow,
  foldSurfaceTokens,
  formatCompactionForModel,
  estimateMessageContent,
} from "@xrkseek/core-session";
import { createToolRegistry } from "@xrkseek/core-tools";
import {
  ContextOverflowError,
  type LlmAdapter,
  type LlmChatRequest,
  type LlmChatResponse,
} from "@xrkseek/llm";
import { runTurn } from "../src/index.js";
import { runCompaction } from "../src/compaction.js";

describe("runTurn compaction / overflow", () => {
  it("recovers once from ContextOverflowError", async () => {
    const store = createMemorySessionStore();
    const session = store.create();
    let chats = 0;
    let sawOverflow = false;
    const llm: LlmAdapter = {
      id: "overflow-once",
      async chat(req: LlmChatRequest): Promise<LlmChatResponse> {
        chats += 1;
        const text = req.messages.map((m) => m.content).join("\n");
        // Summarizer-only call: single user message that is the compaction prompt.
        const isSummarizer =
          req.messages.length === 1 &&
          req.messages[0]?.role === "user" &&
          text.includes("Create a new anchored summary");
        if (isSummarizer) {
          return { content: "## Objective\n- recovered\n## Next\n1. continue" };
        }
        if (!sawOverflow) {
          sawOverflow = true;
          throw new ContextOverflowError("too long");
        }
        return { content: "ok-after-compact" };
      },
    };

    // Seed long history
    for (let i = 0; i < 5; i++) {
      store.append(session.id, {
        type: "user/message",
        ts: i * 2,
        turnId: `old${i}`,
        content: `msg-${i}-` + "x".repeat(50),
      });
      store.append(session.id, {
        type: "assistant/message",
        ts: i * 2 + 1,
        turnId: `old${i}`,
        stepId: `s${i}`,
        content: `ans-${i}`,
      });
    }

    const result = await runTurn({
      sessionId: session.id,
      userText: "continue",
      store,
      llm,
      tools: createToolRegistry(),
      compaction: { keepTokens: 40 },
    });

    expect(result.assistantText).toBe("ok-after-compact");
    const compactEv = store
      .get(session.id)
      .events.find(
        (e) => e.type === "context/compaction" && e.reason === "overflow",
      );
    expect(compactEv?.type).toBe("context/compaction");
    if (compactEv?.type === "context/compaction") {
      expect(compactEv.shadowedTokenCount).toBeTypeOf("number");
      expect(compactEv.shadowedTokenCount).toBeGreaterThan(0);
    }
    const msgs = deriveMessages(store.get(session.id).events);
    expect(msgs.some((m) => String(m.content).includes("recovered"))).toBe(
      true,
    );
  });

  it("runCompaction stamps shadowedTokenCount from priceCurrentSurfaceWindow", async () => {
    const store = createMemorySessionStore();
    const session = store.create();
    store.append(session.id, {
      type: "user/message",
      ts: 1,
      turnId: "t0",
      content: "history alpha beta gamma",
    });
    store.append(session.id, {
      type: "assistant/message",
      ts: 2,
      turnId: "t0",
      stepId: "s0",
      content: "reply delta",
    });
    const before = store.get(session.id).events;
    const expectedShadow = priceCurrentSurfaceWindow(before);
    expect(expectedShadow).toBeGreaterThan(0);

    const llm: LlmAdapter = {
      id: "summarizer",
      async chat() {
        return { content: "## Objective\n- stamp-test" };
      },
    };
    const did = await runCompaction({
      store,
      sessionId: session.id,
      llm,
      reason: "manual",
      keepTokens: 8,
    });
    expect(did.compacted).toBe(true);
    expect(did.event?.shadowedTokenCount).toBe(expectedShadow);

    // Meter fold: surface shrinks to the compaction checkpoint price.
    let surface = 0;
    for (const ev of store.get(session.id).events) {
      surface = foldSurfaceTokens(surface, ev);
    }
    expect(surface).toBe(
      estimateMessageContent(formatCompactionForModel(did.event!)),
    );
  });

  it("does not retry overflow twice", async () => {
    const store = createMemorySessionStore();
    const session = store.create();
    const llm: LlmAdapter = {
      id: "always-overflow",
      async chat(req) {
        const text = req.messages.map((m) => m.content).join("\n");
        const isSummarizer =
          req.messages.length === 1 &&
          req.messages[0]?.role === "user" &&
          (text.includes("Create a new anchored summary") ||
            text.includes("Update the anchored summary"));
        if (isSummarizer) {
          return { content: "## Objective\n- x" };
        }
        throw new ContextOverflowError("still too long");
      },
    };
    store.append(session.id, {
      type: "user/message",
      ts: 1,
      turnId: "t",
      content: "old",
    });

    await expect(
      runTurn({
        sessionId: session.id,
        userText: "go",
        store,
        llm,
        tools: createToolRegistry(),
        compaction: {},
      }),
    ).rejects.toBeInstanceOf(ContextOverflowError);
  });

  it("prunes alone without writing context/compaction (DSH prune-first)", async () => {
    const store = createMemorySessionStore();
    const session = store.create();
    const big = "Z".repeat(9000);
    store.append(session.id, {
      type: "user/message",
      ts: 1,
      turnId: "old",
      content: "seed",
    });
    store.append(session.id, {
      type: "assistant/message",
      ts: 2,
      turnId: "old",
      stepId: "s0",
      content: "",
      toolCalls: [{ id: "c1", name: "read", arguments: {} }],
    });
    store.append(session.id, {
      type: "tool/result",
      ts: 3,
      turnId: "old",
      stepId: "s0",
      result: { toolCallId: "c1", name: "read", content: big },
    });

    let sawOverflow = false;
    let summarizerCalls = 0;
    const llm: LlmAdapter = {
      id: "overflow-prune",
      async chat(req: LlmChatRequest): Promise<LlmChatResponse> {
        const text = req.messages.map((m) => m.content).join("\n");
        const isSummarizer =
          req.messages.length === 1 &&
          req.messages[0]?.role === "user" &&
          text.includes("Create a new anchored summary");
        if (isSummarizer) {
          summarizerCalls += 1;
          // If prune alone clears overflow, summarizer must not run.
          throw new Error("summarizer must not run when prune clears overflow");
        }
        if (!sawOverflow) {
          sawOverflow = true;
          throw new ContextOverflowError("too long");
        }
        return { content: "ok-from-prune" };
      },
    };

    const result = await runTurn({
      sessionId: session.id,
      userText: "continue",
      store,
      llm,
      tools: createToolRegistry(),
      compaction: { keepTokens: 40 },
    });
    expect(result.assistantText).toBe("ok-from-prune");
    expect(summarizerCalls).toBe(0);
    expect(
      store
        .get(session.id)
        .events.some((e) => e.type === "context/compaction"),
    ).toBe(false);
    const toolResults = store
      .get(session.id)
      .events.filter((e) => e.type === "tool/result");
    expect(toolResults.length).toBeGreaterThanOrEqual(2);
    const latest = toolResults[toolResults.length - 1]!;
    expect(String(latest.result.content).length).toBeLessThan(big.length);
    expect(String(latest.result.content)).toContain("chars omitted");
  });

  it("preserves ContextOverflowError when summarizer throws after prune retry", async () => {
    const store = createMemorySessionStore();
    const session = store.create();
    // Short tool result — prune may run but not clear enough; force post-prune
    // overflow then a failing summarizer (DSH: keep original provider error).
    store.append(session.id, {
      type: "user/message",
      ts: 1,
      turnId: "old",
      content: "seed-" + "x".repeat(200),
    });
    store.append(session.id, {
      type: "assistant/message",
      ts: 2,
      turnId: "old",
      stepId: "s0",
      content: "a",
    });

    let conversationCalls = 0;
    const llm: LlmAdapter = {
      id: "overflow-summarizer-throws",
      async chat(req: LlmChatRequest): Promise<LlmChatResponse> {
        const text = req.messages.map((m) => m.content).join("\n");
        const isSummarizer =
          req.messages.length === 1 &&
          req.messages[0]?.role === "user" &&
          text.includes("Create a new anchored summary");
        if (isSummarizer) {
          throw new Error("summary unavailable after prune");
        }
        conversationCalls += 1;
        throw new ContextOverflowError("still too long");
      },
    };

    await expect(
      runTurn({
        sessionId: session.id,
        userText: "go",
        store,
        llm,
        tools: createToolRegistry(),
        compaction: { keepTokens: 40 },
      }),
    ).rejects.toBeInstanceOf(ContextOverflowError);
    expect(conversationCalls).toBeGreaterThanOrEqual(1);
  });

  it("auto-compacts when soft budget maxRequestTokens is exceeded", async () => {
    const store = createMemorySessionStore();
    const session = store.create();
    for (let i = 0; i < 8; i++) {
      store.append(session.id, {
        type: "user/message",
        ts: i * 2,
        turnId: `old${i}`,
        content: `msg-${i}-` + "y".repeat(80),
      });
      store.append(session.id, {
        type: "assistant/message",
        ts: i * 2 + 1,
        turnId: `old${i}`,
        stepId: `s${i}`,
        content: `ans-${i}-` + "z".repeat(40),
      });
    }

    const llm: LlmAdapter = {
      id: "soft-budget",
      async chat(req: LlmChatRequest): Promise<LlmChatResponse> {
        const text = req.messages.map((m) => m.content).join("\n");
        const isSummarizer =
          req.messages.length === 1 &&
          req.messages[0]?.role === "user" &&
          text.includes("Create a new anchored summary");
        if (isSummarizer) {
          return { content: "## Objective\n- soft\n## Next\n1. go" };
        }
        return { content: "ok-after-soft-compact" };
      },
    };

    const result = await runTurn({
      sessionId: session.id,
      userText: "continue",
      store,
      llm,
      tools: createToolRegistry(),
      compaction: {
        maxRequestTokens: 50,
        keepTokens: 20,
        bufferTokens: 0,
      },
    });
    expect(result.assistantText).toBe("ok-after-soft-compact");
    expect(
      store
        .get(session.id)
        .events.some(
          (e) => e.type === "context/compaction" && e.reason === "auto",
        ),
    ).toBe(true);
  });
});
