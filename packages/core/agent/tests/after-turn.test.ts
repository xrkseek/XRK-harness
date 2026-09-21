import { describe, expect, it } from "vitest";
import { createAgent } from "../src/index.js";
import { createMemorySessionStore } from "@xrkseek/core-session";
import { createToolRegistry } from "@xrkseek/core-tools";
import type { LlmAdapter } from "@xrkseek/llm";

const llm: LlmAdapter = {
  async chat() {
    return { content: "ack", toolCalls: [] };
  },
};

describe("afterTurn", () => {
  it("runs after a successful turn and does not fail the turn when it throws", async () => {
    const store = createMemorySessionStore();
    const session = store.create("s-after");
    const seen: string[] = [];
    const agent = createAgent({
      sessionId: session.id,
      store,
      llm,
      tools: createToolRegistry(),
      afterTurn: ({ userText, assistantText }) => {
        seen.push(`${userText ?? ""}|${assistantText}`);
      },
    });
    const result = await agent.continueTurn({ text: "remember: use pnpm" });
    expect(result.text).toBe("ack");
    expect(seen).toEqual(["remember: use pnpm|ack"]);

    const noisy = createAgent({
      sessionId: session.id,
      store,
      llm,
      tools: createToolRegistry(),
      afterTurn: () => {
        throw new Error("memory disk full");
      },
    });
    await expect(noisy.continueTurn({ text: "again" })).resolves.toMatchObject({
      text: "ack",
    });
  });
});
