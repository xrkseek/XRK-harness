import { describe, expect, it } from "vitest";
import { createAgent, SessionBusyError } from "../src/index.js";
import { createMemorySessionStore } from "@xrkseek/core-session";
import { createToolRegistry } from "@xrkseek/core-tools";
import type { LlmAdapter } from "@xrkseek/llm";

function slowLlm(ms: number): LlmAdapter {
  return {
    async chat() {
      await new Promise((r) => setTimeout(r, ms));
      return { content: "ok", toolCalls: [] };
    },
  };
}

describe("createAgent turn latch", () => {
  it("rejects concurrent run on same handle", async () => {
    const store = createMemorySessionStore();
    const session = store.create("s-latch");
    const agent = createAgent({
      sessionId: session.id,
      store,
      llm: slowLlm(80),
      tools: createToolRegistry(),
    });

    const first = agent.run({ text: "one" });
    await expect(agent.run({ text: "two" })).rejects.toBeInstanceOf(
      SessionBusyError,
    );
    await expect(first).resolves.toMatchObject({ text: "ok" });
    await expect(agent.run({ text: "three" })).resolves.toMatchObject({
      text: "ok",
    });
  });
});
