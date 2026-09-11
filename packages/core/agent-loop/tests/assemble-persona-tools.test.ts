import { describe, expect, it } from "vitest";
import { createMemorySessionStore } from "@xrkseek/core-session";
import { createToolRegistry } from "@xrkseek/core-tools";
import type { LlmAdapter } from "@xrkseek/llm";
import { runTurn } from "../src/index.js";

describe("runTurn assemble persona(toolNames)", () => {
  it("rebuilds persona from the materialized tool catalog each step", async () => {
    const store = createMemorySessionStore();
    const session = store.create();
    const tools = createToolRegistry();
    tools.register({
      name: "read_file",
      description: "read",
      parameters: { type: "object", properties: {} },
      async execute() {
        return { content: "ok" };
      },
    });
    tools.register({
      name: "web_search",
      description: "search",
      parameters: { type: "object", properties: {} },
      async execute() {
        return { content: "ok" };
      },
    });

    const seen: string[] = [];
    const llm: LlmAdapter = {
      id: "capture",
      async chat(req) {
        const system = req.messages.find((m) => m.role === "system");
        seen.push(typeof system?.content === "string" ? system.content : "");
        return { content: "ok" };
      },
    };

    await runTurn({
      sessionId: session.id,
      userText: "hello",
      store,
      llm,
      tools,
      assemble: {
        persona: ({ toolNames }) => {
          const names = new Set(toolNames);
          const parts = ["BASE"];
          if (names.has("read_file")) parts.push("File tools: prefer `read_file`.");
          if (names.has("web_search")) {
            parts.push("Use the web_search tool.");
          }
          return parts.join("\n\n");
        },
      },
    });

    expect(seen[0]).toContain("BASE");
    expect(seen[0]).toContain("read_file");
    expect(seen[0]).toContain("web_search");

    tools.unregister("web_search");
    seen.length = 0;
    await runTurn({
      sessionId: session.id,
      userText: "again",
      store,
      llm,
      tools,
      assemble: {
        persona: ({ toolNames }) => {
          const names = new Set(toolNames);
          const parts = ["BASE"];
          if (names.has("read_file")) parts.push("File tools: prefer `read_file`.");
          if (names.has("web_search")) {
            parts.push("Use the web_search tool.");
          }
          return parts.join("\n\n");
        },
      },
    });

    expect(seen[0]).toContain("BASE");
    expect(seen[0]).toContain("read_file");
    expect(seen[0]).not.toContain("web_search");
  });
});
