import { describe, expect, it } from "vitest";
import { createAgent } from "../src/index.js";
import { createMemorySessionStore } from "@xrkseek/core-session";
import { createToolRegistry } from "@xrkseek/core-tools";
import type { LlmAdapter } from "@xrkseek/llm";

function summaryLlm(): LlmAdapter {
  return {
    async chat() {
      return { content: "## Objective\n- compact-test", toolCalls: [] };
    },
  };
}

describe("createAgent compactNow", () => {
  it("returns empty when there is no compactable history", async () => {
    const store = createMemorySessionStore();
    const session = store.create("c-empty");
    const agent = createAgent({
      sessionId: session.id,
      store,
      llm: summaryLlm(),
      tools: createToolRegistry(),
      compaction: { keepTokens: 1 },
    });
    await expect(agent.compactNow!()).resolves.toEqual({
      compacted: false,
      reason: "empty",
    });
  });

  it("appends context/compaction with reason manual", async () => {
    const store = createMemorySessionStore();
    const session = store.create("c-ok");
    store.append(session.id, {
      type: "user/message",
      ts: 1,
      turnId: "t0",
      content: "hello there",
    });
    store.append(session.id, {
      type: "assistant/message",
      ts: 2,
      turnId: "t0",
      stepId: "s0",
      content: "hi",
    });
    const agent = createAgent({
      sessionId: session.id,
      store,
      llm: summaryLlm(),
      tools: createToolRegistry(),
      compaction: { keepTokens: 1 },
    });
    const out = await agent.compactNow!();
    expect(out.compacted).toBe(true);
    expect(out.shadowedMessages).toBeGreaterThan(0);
    const events = store.get(session.id).events;
    const last = events[events.length - 1];
    expect(last).toMatchObject({
      type: "context/compaction",
      reason: "manual",
      summary: "## Objective\n- compact-test",
    });
    if (last?.type === "context/compaction") {
      expect(last.shadowedTokenCount).toBeTypeOf("number");
      expect(last.shadowedTokenCount).toBeGreaterThan(0);
      expect(out.shadowedTokens).toBe(last.shadowedTokenCount);
    }
    expect(out.summarySeq).toBe(events.length);
  });

  it("returns busy while a turn is in flight", async () => {
    const store = createMemorySessionStore();
    const session = store.create("c-busy");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const llm: LlmAdapter = {
      async chat() {
        await gate;
        return { content: "ok", toolCalls: [] };
      },
    };
    const agent = createAgent({
      sessionId: session.id,
      store,
      llm,
      tools: createToolRegistry(),
    });
    const turn = agent.run({ text: "one" });
    await expect(agent.compactNow!()).resolves.toEqual({
      compacted: false,
      reason: "busy",
    });
    release();
    await turn;
  });
});
