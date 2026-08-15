import { describe, expect, it } from "vitest";
import { createMemorySessionStore } from "@xrkseek/core-session";
import { createToolRegistry } from "@xrkseek/core-tools";
import type { LlmAdapter } from "@xrkseek/llm";
import { runTurn } from "../src/index.js";

describe("runTurn assemble", () => {
  it("keeps volatile out of system while completing turn", async () => {
    const store = createMemorySessionStore();
    const session = store.create();
    const captured: { role: string; content: string }[][] = [];
    const llm: LlmAdapter = {
      id: "capture",
      async chat(req) {
        captured.push(
          req.messages.map((m) => ({ role: m.role, content: m.content })),
        );
        return { content: "ok" };
      },
    };

    await runTurn({
      sessionId: session.id,
      userText: "hello",
      store,
      llm,
      tools: createToolRegistry(),
      assemble: { persona: "PersonaZ", owner: "xrk" },
      now: () => Date.parse("2026-08-15T00:00:00.000Z"),
    });

    const msgs = captured[0]!;
    const system = msgs.find((m) => m.role === "system");
    expect(system?.content).toContain("PersonaZ");
    expect(system?.content).not.toContain("volatile");
    expect(msgs.some((m) => m.content.startsWith("[volatile]"))).toBe(true);
  });
});
