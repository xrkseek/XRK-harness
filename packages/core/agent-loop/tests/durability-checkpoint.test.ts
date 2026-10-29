import { describe, expect, it, vi } from "vitest";
import { createMemorySessionStore } from "@xrkseek/core-session";
import { createToolRegistry } from "@xrkseek/core-tools";
import { createReplayAdapter } from "@xrkseek/llm-replay";
import { runTurn } from "../src/index.js";

describe("runTurn durability checkpoints", () => {
  it("flushes before the LLM call and again before tool bodies", async () => {
    const base = createMemorySessionStore();
    const flush = vi.fn();
    const store = Object.assign(base, { flush });
    const session = store.create();
    const tools = createToolRegistry();
    const order: string[] = [];
    tools.register({
      name: "echo",
      description: "echo",
      parameters: { type: "object", properties: {} },
      async execute() {
        order.push("execute");
        return { content: "ok" };
      },
    });

    const llm = createReplayAdapter([
      {
        content: "",
        toolCalls: [{ id: "c1", name: "echo", arguments: {} }],
      },
      { content: "done" },
    ]);
    const originalChat = llm.chat.bind(llm);
    llm.chat = async (req) => {
      order.push("llm");
      expect(flush.mock.calls.length).toBeGreaterThanOrEqual(1);
      return originalChat(req);
    };

    await runTurn({
      sessionId: session.id,
      userText: "go",
      store,
      llm,
      tools,
    });

    expect(order[0]).toBe("llm");
    expect(order).toContain("execute");
    // At least: before first LLM, before tools, before second LLM.
    expect(flush.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(flush.mock.calls.every((c) => c[0] === session.id)).toBe(true);
  });
});
