import { describe, expect, it, beforeEach } from "vitest";
import { createMemorySessionStore } from "@xrkseek/core-session";
import { createToolRegistry } from "@xrkseek/core-tools";
import { CURRENT_MESSAGE_LABEL } from "@xrkseek/core-system-prompt";
import type { LlmAdapter } from "@xrkseek/llm";
import type { ChatMessage } from "@xrkseek/protocol";
import { clearSeriesBaselineAnchors, runTurn } from "../src/index.js";

beforeEach(() => {
  clearSeriesBaselineAnchors();
});

describe("standing plan vs first-step skeleton", () => {
  it("still stamps CURRENT_MESSAGE when an open plan trails deriveMessages", async () => {
    const store = createMemorySessionStore();
    const session = store.create();
    store.append(session.id, {
      type: "todo/write",
      ts: 1,
      todos: [{ content: "ship", status: "in_progress" }],
    });
    const tools = createToolRegistry();
    const captured: ChatMessage[][] = [];
    const llm: LlmAdapter = {
      id: "capture",
      systemPromptUpdate: "in-history",
      async chat(req) {
        captured.push(req.messages.map((m) => ({ ...m })));
        return { content: "ok" };
      },
    };

    await runTurn({
      sessionId: session.id,
      userText: "continue the plan",
      store,
      llm,
      tools,
      assemble: { persona: "PersonaBase" },
      now: (() => {
        let t = 1_700_000_000_000;
        return () => ++t;
      })(),
    });

    expect(captured).toHaveLength(1);
    const users = captured[0]!.filter((m) => m.role === "user");
    const live = users.find(
      (m) =>
        typeof m.content === "string" &&
        m.content.includes("continue the plan"),
    );
    expect(live).toBeDefined();
    expect(String(live?.content)).toContain(CURRENT_MESSAGE_LABEL);
    expect(String(live?.content)).toMatch(/time:/);
    // Plan stays trailing (after the live user), not blocking skeleton lift.
    const plan = users.at(-1);
    expect(String(plan?.content)).toContain("[in_progress] ship");
    expect(String(plan?.content)).not.toContain(CURRENT_MESSAGE_LABEL);
  });
});
