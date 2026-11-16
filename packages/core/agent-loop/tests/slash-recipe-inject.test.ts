import { describe, expect, it, beforeEach } from "vitest";
import { createMemorySessionStore, deriveMessages } from "@xrkseek/core-session";
import { createToolRegistry } from "@xrkseek/core-tools";
import type { LlmAdapter } from "@xrkseek/llm";
import type { ChatMessage } from "@xrkseek/protocol";
import { clearSeriesBaselineAnchors, runTurn } from "../src/index.js";

beforeEach(() => {
  clearSeriesBaselineAnchors();
});

describe("slash recipe as durable inject (not system)", () => {
  it("keeps message-0 stable when recipe text changes across turns", async () => {
    const store = createMemorySessionStore();
    const session = store.create();
    const tools = createToolRegistry();
    const captured: ChatMessage[][] = [];
    let recipe = "be brief";

    const llm: LlmAdapter = {
      id: "capture",
      systemPromptUpdate: "in-history",
      async chat(req) {
        captured.push(req.messages.map((m) => ({ ...m })));
        return { content: `ok-${captured.length}` };
      },
    };

    await runTurn({
      sessionId: session.id,
      userText: "/brief do thing",
      store,
      llm,
      tools,
      assemble: {
        persona: "PersonaBase",
        resolveSlash: async (text) =>
          text.startsWith("/")
            ? { userPrompt: text.replace(/^\/\S+\s*/, ""), systemExtra: recipe }
            : null,
      },
      now: (() => {
        let t = 0;
        return () => ++t;
      })(),
    });

    recipe = "be thorough and cite paths";
    await runTurn({
      sessionId: session.id,
      userText: "/brief next",
      store,
      llm,
      tools,
      assemble: {
        persona: "PersonaBase",
        resolveSlash: async (text) =>
          text.startsWith("/")
            ? { userPrompt: text.replace(/^\/\S+\s*/, ""), systemExtra: recipe }
            : null,
      },
      now: (() => {
        let t = 100;
        return () => ++t;
      })(),
    });

    expect(captured).toHaveLength(2);
    expect(captured[0]![0]?.content).toBe("PersonaBase");
    expect(captured[1]![0]?.content).toBe(captured[0]![0]?.content);
    // Same fragmentId → last-wins in deriveMessages (does not stack forever).
    const events = store.get(session.id).events;
    const loggedRecipes = events.filter(
      (e) =>
        e.type === "user/message" &&
        e.source?.kind === "context-fragment" &&
        e.source.fragmentId === "slash-recipe",
    );
    expect(loggedRecipes).toHaveLength(2);
    const derived = deriveMessages(events);
    const recipeMsgs = derived.filter(
      (m) =>
        m.role === "user" &&
        typeof m.content === "string" &&
        m.content.includes("## Recipe"),
    );
    expect(recipeMsgs).toHaveLength(1);
    expect(String(recipeMsgs[0]?.content)).toContain("be thorough");
    expect(String(captured[0]![0]?.content)).not.toContain("be brief");
    expect(String(captured[1]![0]?.content)).not.toContain("be thorough");
    // Second turn wire still sees the latest recipe in history (not system).
    const secondUsers = captured[1]!.filter((m) => m.role === "user");
    expect(
      secondUsers.some(
        (m) =>
          typeof m.content === "string" &&
          m.content.includes("be thorough"),
      ),
    ).toBe(true);
  });
});
