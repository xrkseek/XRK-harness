import { describe, expect, it } from "vitest";
import {
  createMemorySessionStore,
  deriveAutoCompactMaxTokens,
  resolveSoftBudgetTokens,
  resolveSoftBudgetTriggerTokens,
} from "@xrkseek/core-session";
import { createToolRegistry } from "@xrkseek/core-tools";
import type { LlmAdapter, LlmChatRequest, LlmChatResponse } from "@xrkseek/llm";
import { createRoutingLlmAdapter } from "@xrkseek/llm-registry";
import { runTurn } from "../src/index.js";

describe("Codex window-derived soft budget", () => {
  it("deriveAutoCompactMaxTokens is floor(window × 0.9)", () => {
    expect(deriveAutoCompactMaxTokens(undefined)).toBeUndefined();
    expect(deriveAutoCompactMaxTokens(7_999)).toBeUndefined();
    expect(deriveAutoCompactMaxTokens(256_000)).toBe(230_400);
  });

  it("auto-compacts when soft budget is blank but contextWindow is set", async () => {
    const store = createMemorySessionStore();
    const session = store.create();
    // Same padding density as route-softBudgetMaxTokens case; soft derives to
    // floor(8000×0.9)=7200 so history must exceed the ~90% trigger (~6480).
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
      id: "inner-window-derive",
      async chat(req: LlmChatRequest): Promise<LlmChatResponse> {
        const text = req.messages.map((m) => m.content).join("\n");
        const isSummarizer =
          req.messages.length === 1 &&
          req.messages[0]?.role === "user" &&
          text.includes("Create a new anchored summary");
        if (isSummarizer) {
          return { content: "## Objective\n- window\n## Next\n1. go" };
        }
        return { content: "ok-after-window-derive" };
      },
    };
    const llm = createRoutingLlmAdapter({
      id: "window-derive",
      getSelection: () => ({
        provider: "test",
        model: "m",
        contextWindow: 8_000,
        // softBudgetMaxTokens omitted → derive floor(window×0.9)
      }),
      resolveAdapter: () => inner,
    });

    const result = await runTurn({
      sessionId: session.id,
      userText: "continue",
      store,
      llm,
      tools: createToolRegistry(),
      compaction: {
        keepTokens: 40,
        bufferTokens: 0,
      },
    });
    expect(result.assistantText).toBe("ok-after-window-derive");
    expect(
      store
        .get(session.id)
        .events.some(
          (e) => e.type === "context/compaction" && e.reason === "auto",
        ),
    ).toBe(true);
  });

  it("user soft below window×90% wins (stricter)", () => {
    const resolved = resolveSoftBudgetTokens({
      softBudgetMaxTokens: 100_000,
      contextWindow: 256_000,
      bufferTokens: 0,
    });
    expect(resolved?.maxRequestTokens).toBe(100_000);
  });

  it("window-force soft does not apply trigger percent twice", () => {
    const force = deriveAutoCompactMaxTokens(8_000)!;
    expect(force).toBe(7_200);
    expect(
      resolveSoftBudgetTriggerTokens({
        maxRequestTokens: force,
        triggerRatio: 0.9,
        windowForceTokens: force,
      }),
    ).toBe(7_200);
  });
});
