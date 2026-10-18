import { describe, expect, it } from "vitest";
import {
  createMemorySessionStore,
  deriveMessages,
  priceCurrentSurfaceWindow,
  foldSurfaceTokens,
  formatCompactionForModel,
  estimateMessageContent,
} from "@xrkseek/core-session";
import {
  createToolRegistry,
  createToolSearchTool,
  TOOL_SEARCH_NAME,
} from "@xrkseek/core-tools";
import {
  ContextOverflowError,
  LlmError,
  type LlmAdapter,
  type LlmChatRequest,
  type LlmChatResponse,
} from "@xrkseek/llm";
import { createRoutingLlmAdapter } from "@xrkseek/llm-registry";
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

  it("retries summarizer SERVER failures when retry policy is wired", async () => {
    const store = createMemorySessionStore();
    const session = store.create();
    for (let i = 0; i < 6; i++) {
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
    let chats = 0;
    const llm: LlmAdapter = {
      id: "summarizer-flaky",
      async chat() {
        chats += 1;
        if (chats === 1) {
          throw new LlmError("openai-compatible HTTP 502: tool-less summarizer", "SERVER", {
            status: 502,
          });
        }
        return { content: "## Objective\n- after-retry" };
      },
    };
    const did = await runCompaction({
      store,
      sessionId: session.id,
      llm,
      reason: "auto",
      keepTokens: 8,
      turnId: "turn_retry",
      stepId: "step_retry",
      retry: { maxRetries: 2, initialDelayMs: 1, maxDelayMs: 1, jitterRatio: 0 },
    });
    expect(did.compacted).toBe(true);
    expect(chats).toBe(2);
    const retryEv = store
      .get(session.id)
      .events.find((e) => e.type === "llm/retry");
    expect(retryEv?.type === "llm/retry" && retryEv.failure.code).toBe("SERVER");
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
        // One-shot summarizer: this case asserts overflow masking, not retry.
        llmRetry: false,
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

  it("auto-compacts from route softBudgetMaxTokens without CompactionOptions.max", async () => {
    const store = createMemorySessionStore();
    const session = store.create();
    // Catalog softBudgetMaxTokens requires ≥8k; pad history over that ceiling.
    for (let i = 0; i < 24; i++) {
      store.append(session.id, {
        type: "user/message",
        ts: i * 2,
        turnId: `old${i}`,
        content: `msg-${i}-` + "y".repeat(1_200),
      });
      store.append(session.id, {
        type: "assistant/message",
        ts: i * 2 + 1,
        turnId: `old${i}`,
        stepId: `s${i}`,
        content: `ans-${i}-` + "z".repeat(1_200),
      });
    }

    const inner: LlmAdapter = {
      id: "inner-route-soft",
      async chat(req: LlmChatRequest): Promise<LlmChatResponse> {
        const text = req.messages.map((m) => m.content).join("\n");
        const isSummarizer =
          req.messages.length === 1 &&
          req.messages[0]?.role === "user" &&
          text.includes("Create a new anchored summary");
        if (isSummarizer) {
          return { content: "## Objective\n- route\n## Next\n1. go" };
        }
        return { content: "ok-after-route-soft" };
      },
    };
    const llm = createRoutingLlmAdapter({
      id: "route-soft",
      getSelection: () => ({
        provider: "deepseek",
        model: "deepseek-flash",
        softBudgetMaxTokens: 8_000,
        softBudgetBufferTokens: 0,
        softBudgetKeepTokens: 2_000,
      }),
      resolveAdapter: () => inner,
    });

    const result = await runTurn({
      sessionId: session.id,
      userText: "continue",
      store,
      llm,
      tools: createToolRegistry(),
      compaction: {},
    });
    expect(result.assistantText).toBe("ok-after-route-soft");
    expect(
      store
        .get(session.id)
        .events.some(
          (e) => e.type === "context/compaction" && e.reason === "auto",
        ),
    ).toBe(true);
  });

  it("auto-compacts when provider pressure exceeds soft budget despite small local estimate", async () => {
    const store = createMemorySessionStore();
    const session = store.create();
    // Enough history to summarize; last usage already over the soft ceiling.
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
        ...(i === 7
          ? {
              usage: {
                inputTokens: 80_000,
                outputTokens: 5,
                cacheReadTokens: 20_000,
              },
            }
          : {}),
      });
    }

    const llm: LlmAdapter = {
      id: "soft-budget-pressure",
      async chat(req: LlmChatRequest): Promise<LlmChatResponse> {
        const text = req.messages.map((m) => m.content).join("\n");
        const isSummarizer =
          req.messages.length === 1 &&
          req.messages[0]?.role === "user" &&
          text.includes("Create a new anchored summary");
        if (isSummarizer) {
          return { content: "## Objective\n- pressure\n## Next\n1. go" };
        }
        return { content: "ok-after-pressure-compact" };
      },
    };

    const result = await runTurn({
      sessionId: session.id,
      userText: "continue",
      store,
      llm,
      tools: createToolRegistry(),
      compaction: {
        maxRequestTokens: 50_000,
        // Keep must be below local history so prepareCompactionPayload has work
        // (pressure alone cannot summarize an empty shadow window).
        keepTokens: 40,
        bufferTokens: 0,
      },
    });
    expect(result.assistantText).toBe("ok-after-pressure-compact");
    expect(
      store
        .get(session.id)
        .events.some(
          (e) => e.type === "context/compaction" && e.reason === "auto",
        ),
    ).toBe(true);
  });

  it("caps soft maxRequestTokens by route contextWindow when soft exceeds window", async () => {
    const store = createMemorySessionStore();
    const session = store.create();
    const fatParams = {
      type: "object",
      properties: Object.fromEntries(
        Array.from({ length: 40 }, (_, i) => [
          `p${i}`,
          { type: "string", description: "x".repeat(200) },
        ]),
      ),
    };
    const tools = createToolRegistry();
    for (let i = 0; i < 30; i++) {
      tools.register({
        name: `fat_tool_${i}`,
        description: "d".repeat(100),
        parameters: fatParams,
        async execute() {
          return { content: "ok" };
        },
      });
    }

    await expect(
      runTurn({
        sessionId: session.id,
        userText: "hi",
        store,
        llm: {
          id: "window-cap",
          // Floor for clamp is 8k (same as soft catalog minimum).
          peekRoute: () => ({ contextWindow: 8_000 }),
          ensureRoute: () => ({ contextWindow: 8_000 }),
          async chat() {
            throw new Error("LLM must not run when window-capped soft budget fails");
          },
        },
        tools,
        // Explicit soft far above the advertised window — must clamp to 8k.
        compaction: {
          maxRequestTokens: 200_000,
          keepTokens: 50,
          bufferTokens: 0,
        },
      }),
    ).rejects.toBeInstanceOf(ContextOverflowError);

    const turnEnd = store.get(session.id).events.find((e) => e.type === "turn/end");
    expect(turnEnd?.type === "turn/end" && turnEnd.reason).toMatchObject({
      kind: "error",
      error: { code: "CONTEXT_WINDOW_EXCEEDED" },
    });
  });

  it("fail-closes soft budget when tool schemas alone exceed the ceiling", async () => {
    const store = createMemorySessionStore();
    const session = store.create();
    const fatParams = {
      type: "object",
      properties: Object.fromEntries(
        Array.from({ length: 40 }, (_, i) => [
          `p${i}`,
          { type: "string", description: "x".repeat(200) },
        ]),
      ),
    };
    const tools = createToolRegistry();
    for (let i = 0; i < 30; i++) {
      tools.register({
        name: `fat_tool_${i}`,
        description: "d".repeat(100),
        parameters: fatParams,
        async execute() {
          return { content: "ok" };
        },
      });
    }

    await expect(
      runTurn({
        sessionId: session.id,
        userText: "hi",
        store,
        llm: {
          id: "should-not-run",
          async chat() {
            throw new Error("LLM must not be called when soft budget fails closed");
          },
        },
        tools,
        compaction: {
          maxRequestTokens: 200,
          keepTokens: 50,
          bufferTokens: 0,
        },
      }),
    ).rejects.toBeInstanceOf(ContextOverflowError);

    const turnEnd = store
      .get(session.id)
      .events.find((e) => e.type === "turn/end");
    expect(turnEnd?.type).toBe("turn/end");
    if (turnEnd?.type === "turn/end") {
      expect(turnEnd.reason).toMatchObject({
        kind: "error",
        error: { code: "CONTEXT_WINDOW_EXCEEDED" },
      });
      expect(
        turnEnd.reason.kind === "error" &&
          String(
            (turnEnd.reason.error as { message?: string }).message ?? "",
          ),
      ).toMatch(/soft budget/i);
      expect(
        turnEnd.reason.kind === "error" &&
          String(
            (turnEnd.reason.error as { message?: string }).message ?? "",
          ),
      ).toMatch(/conversation surface ~\d+/i);
      expect(
        turnEnd.reason.kind === "error" &&
          String(
            (turnEnd.reason.error as { message?: string }).message ?? "",
          ),
      ).toMatch(/tools ~\d+/i);
    }
  });

  it("soft budget ignores deferred MCP schemas when tool_search is on the wire", async () => {
    const store = createMemorySessionStore();
    const session = store.create();
    const fatParams = {
      type: "object",
      properties: Object.fromEntries(
        Array.from({ length: 40 }, (_, i) => [
          `p${i}`,
          { type: "string", description: "x".repeat(200) },
        ]),
      ),
    };
    const tools = createToolRegistry();
    for (let i = 0; i < 30; i++) {
      tools.register({
        name: `mcp__fat__tool_${i}`,
        description: "d".repeat(100),
        parameters: fatParams,
        exposure: "deferred",
        async execute() {
          return { content: "ok" };
        },
      });
    }
    const expanded = new Set<string>();
    tools.register(
      createToolSearchTool({
        listTools: () => tools.list(),
        state: {
          listExpanded: () => expanded,
          expand: (names) => {
            for (const n of names) expanded.add(n);
          },
        },
      }),
    );
    expect(tools.get(TOOL_SEARCH_NAME)).toBeDefined();

    const result = await runTurn({
      sessionId: session.id,
      userText: "hi",
      store,
      llm: {
        id: "after-defer",
        async chat(req) {
          // Deferred MCP must not ride the soft-budget / outbound catalog.
          expect(req.tools?.some((t) => t.name.startsWith("mcp__"))).toBe(
            false,
          );
          expect(req.tools?.some((t) => t.name === TOOL_SEARCH_NAME)).toBe(
            true,
          );
          return { content: "ok-deferred-hidden" };
        },
      },
      tools,
      expandedToolNames: () => expanded,
      compaction: {
        maxRequestTokens: 2_000,
        keepTokens: 500,
        bufferTokens: 0,
      },
    });
    expect(result.assistantText).toBe("ok-deferred-hidden");
  });

  it("does not false-kill when bufferTokens >= maxRequestTokens", async () => {
    const store = createMemorySessionStore();
    const session = store.create();
    const llm: LlmAdapter = {
      id: "buffer-clamp",
      async chat() {
        return { content: "ok-despite-fat-buffer" };
      },
    };
    const result = await runTurn({
      sessionId: session.id,
      userText: "hi",
      store,
      llm,
      tools: createToolRegistry(),
      compaction: {
        maxRequestTokens: 100,
        bufferTokens: 10_000,
        keepTokens: 40,
      },
    });
    expect(result.assistantText).toBe("ok-despite-fat-buffer");
  });

  it("soft-budgets long assistant reasoning (no leak past ceiling)", async () => {
    const store = createMemorySessionStore();
    const session = store.create();
    store.append(session.id, {
      type: "user/message",
      ts: 1,
      turnId: "t0",
      content: "ask",
    });
    store.append(session.id, {
      type: "assistant/message",
      ts: 2,
      turnId: "t0",
      stepId: "s0",
      content: "ans",
      reasoning: "think-".repeat(400),
    });

    let summaryCalls = 0;
    const result = await runTurn({
      sessionId: session.id,
      userText: "next",
      store,
      llm: {
        id: "reasoning-soft-budget",
        async chat(req: LlmChatRequest) {
          const text = req.messages.map((m) => m.content).join("\n");
          const isSummarizer =
            req.messages.length === 1 &&
            req.messages[0]?.role === "user" &&
            text.includes("Create a new anchored summary");
          if (isSummarizer) {
            summaryCalls += 1;
            return { content: "## Objective\n- x\n## Next\n1. y" };
          }
          // Main path must only run after soft budget saw reasoning and compacted.
          expect(summaryCalls).toBeGreaterThan(0);
          return { content: "ok-after-reasoning-compact" };
        },
      },
      tools: createToolRegistry(),
      compaction: {
        maxRequestTokens: 80,
        keepTokens: 20,
        bufferTokens: 0,
      },
    });
    expect(summaryCalls).toBeGreaterThan(0);
    expect(
      store
        .get(session.id)
        .events.some(
          (e) => e.type === "context/compaction" && e.reason === "auto",
        ),
    ).toBe(true);
    expect(result.assistantText).toBe("ok-after-reasoning-compact");
  });

  it("softBudgetTriggerRatio starts auto-compact before the soft ceiling", async () => {
    const store = createMemorySessionStore();
    const session = store.create();
    // Same seed as the soft-budget ceiling case (~exceeds 50 tokens).
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
    let summaryCalls = 0;
    const result = await runTurn({
      sessionId: session.id,
      userText: "continue",
      store,
      llm: {
        id: "soft-trigger",
        async chat(req) {
          const text = req.messages.map((m) => m.content).join("\n");
          if (
            req.messages.length === 1 &&
            req.messages[0]?.role === "user" &&
            text.includes("Create a new anchored summary")
          ) {
            summaryCalls += 1;
            return { content: "## Objective\n- trimmed\n## Next\n1. go" };
          }
          return { content: "ok-after-trigger" };
        },
      },
      tools: createToolRegistry(),
      compaction: {
        // Ceiling 500 stays above this seed; trigger at 10% must still compact.
        maxRequestTokens: 500,
        keepTokens: 40,
        bufferTokens: 0,
        softBudgetTriggerRatio: 0.1,
        softBudgetPeelAttempts: 0,
      },
    });
    expect(summaryCalls).toBeGreaterThan(0);
    expect(result.assistantText).toBe("ok-after-trigger");
    expect(
      store
        .get(session.id)
        .events.some(
          (e) => e.type === "context/compaction" && e.reason === "auto",
        ),
    ).toBe(true);
  });

  it("soft budget still auto-compacts when trigger sits above the buffer ceiling", async () => {
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
    let summaryCalls = 0;
    const result = await runTurn({
      sessionId: session.id,
      userText: "continue",
      store,
      llm: {
        id: "soft-ceiling-above-trigger",
        async chat(req) {
          const text = req.messages.map((m) => m.content).join("\n");
          if (
            req.messages.length === 1 &&
            req.messages[0]?.role === "user" &&
            text.includes("Create a new anchored summary")
          ) {
            summaryCalls += 1;
            return { content: "## Objective\n- trimmed\n## Next\n1. go" };
          }
          return { content: "ok-after-ceiling" };
        },
      },
      tools: createToolRegistry(),
      compaction: {
        // softTrigger = 100 * 1.0 = 100, softCeiling = 100 - 40 = 60.
        // Seed exceeds 60 but stays under 100 — must still compact.
        maxRequestTokens: 100,
        keepTokens: 40,
        bufferTokens: 40,
        softBudgetTriggerRatio: 1,
        softBudgetPeelAttempts: 0,
      },
    });
    expect(summaryCalls).toBeGreaterThan(0);
    expect(result.assistantText).toBe("ok-after-ceiling");
  });

  it("strategy off skips soft-budget auto path", async () => {
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
    let chatCalls = 0;
    const result = await runTurn({
      sessionId: session.id,
      userText: "continue",
      store,
      llm: {
        id: "strategy-off",
        async chat() {
          chatCalls += 1;
          return { content: "ok-no-soft-compact" };
        },
      },
      tools: createToolRegistry(),
      compaction: {
        maxRequestTokens: 50,
        keepTokens: 20,
        bufferTokens: 0,
        strategy: "off",
      },
    });
    expect(result.assistantText).toBe("ok-no-soft-compact");
    expect(chatCalls).toBe(1);
    expect(
      store
        .get(session.id)
        .events.some((e) => e.type === "context/compaction"),
    ).toBe(false);
  });

  it("strategy prune-only fails closed without LLM summary", async () => {
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
    await expect(
      runTurn({
        sessionId: session.id,
        userText: "continue",
        store,
        llm: {
          id: "prune-only",
          async chat() {
            throw new Error("LLM must not run under prune-only soft-budget");
          },
        },
        tools: createToolRegistry(),
        compaction: {
          maxRequestTokens: 50,
          keepTokens: 20,
          bufferTokens: 0,
          strategy: "prune-only",
        },
      }),
    ).rejects.toBeInstanceOf(ContextOverflowError);
    expect(
      store
        .get(session.id)
        .events.some((e) => e.type === "context/compaction"),
    ).toBe(false);
  });

  it("strategy summary-only soft-budget summarizes without prune", async () => {
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
    let summaryCalls = 0;
    const result = await runTurn({
      sessionId: session.id,
      userText: "continue",
      store,
      llm: {
        id: "summary-only-soft",
        async chat(req: LlmChatRequest) {
          const text = req.messages.map((m) => m.content).join("\n");
          const isSummarizer =
            req.messages.length === 1 &&
            req.messages[0]?.role === "user" &&
            text.includes("Create a new anchored summary");
          if (isSummarizer) {
            summaryCalls += 1;
            return { content: "## Objective\n- soft\n## Next\n1. go" };
          }
          expect(summaryCalls).toBeGreaterThan(0);
          return { content: "ok-summary-only" };
        },
      },
      tools: createToolRegistry(),
      compaction: {
        maxRequestTokens: 50,
        keepTokens: 20,
        bufferTokens: 0,
        strategy: "summary-only",
      },
    });
    expect(result.assistantText).toBe("ok-summary-only");
    expect(summaryCalls).toBeGreaterThan(0);
    expect(
      store
        .get(session.id)
        .events.some(
          (e) => e.type === "context/compaction" && e.reason === "auto",
        ),
    ).toBe(true);
  });

  it("strategy off skips overflow recovery", async () => {
    const store = createMemorySessionStore();
    const session = store.create();
    store.append(session.id, {
      type: "user/message",
      ts: 1,
      turnId: "old",
      content: "seed",
    });
    await expect(
      runTurn({
        sessionId: session.id,
        userText: "continue",
        store,
        llm: {
          id: "overflow-off",
          async chat() {
            throw new ContextOverflowError("too long");
          },
        },
        tools: createToolRegistry(),
        compaction: { keepTokens: 40, strategy: "off" },
      }),
    ).rejects.toBeInstanceOf(ContextOverflowError);
    expect(
      store
        .get(session.id)
        .events.some((e) => e.type === "context/compaction"),
    ).toBe(false);
  });

  it("strategy prune-only overflow does not summarize", async () => {
    const store = createMemorySessionStore();
    const session = store.create();
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
    await expect(
      runTurn({
        sessionId: session.id,
        userText: "continue",
        store,
        llm: {
          id: "overflow-prune-only",
          async chat(req: LlmChatRequest) {
            const text = req.messages.map((m) => m.content).join("\n");
            const isSummarizer =
              req.messages.length === 1 &&
              req.messages[0]?.role === "user" &&
              text.includes("Create a new anchored summary");
            if (isSummarizer) {
              throw new Error("summarizer must not run under prune-only overflow");
            }
            throw new ContextOverflowError("still too long");
          },
        },
        tools: createToolRegistry(),
        compaction: { keepTokens: 40, strategy: "prune-only" },
      }),
    ).rejects.toBeInstanceOf(ContextOverflowError);
    expect(
      store
        .get(session.id)
        .events.some((e) => e.type === "context/compaction"),
    ).toBe(false);
  });

  it("strategy summary-only overflow skips prune and summarizes", async () => {
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
    const result = await runTurn({
      sessionId: session.id,
      userText: "continue",
      store,
      llm: {
        id: "overflow-summary-only",
        async chat(req: LlmChatRequest) {
          const text = req.messages.map((m) => m.content).join("\n");
          const isSummarizer =
            req.messages.length === 1 &&
            req.messages[0]?.role === "user" &&
            text.includes("Create a new anchored summary");
          if (isSummarizer) {
            summarizerCalls += 1;
            return { content: "## Objective\n- ov\n## Next\n1. go" };
          }
          if (!sawOverflow) {
            sawOverflow = true;
            throw new ContextOverflowError("too long");
          }
          return { content: "ok-summary-only-overflow" };
        },
      },
      tools: createToolRegistry(),
      compaction: { keepTokens: 40, strategy: "summary-only" },
    });
    expect(result.assistantText).toBe("ok-summary-only-overflow");
    expect(summarizerCalls).toBeGreaterThan(0);
    expect(
      store
        .get(session.id)
        .events.some(
          (e) => e.type === "context/compaction" && e.reason === "overflow",
        ),
    ).toBe(true);
    // summary-only must not append a pruned tool/result surface.
    const toolResults = store
      .get(session.id)
      .events.filter((e) => e.type === "tool/result");
    expect(toolResults).toHaveLength(1);
    expect(String(toolResults[0]!.result.content).length).toBe(big.length);
  });
});
