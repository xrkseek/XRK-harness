import { describe, expect, it } from "vitest";
import { createMemorySessionStore } from "@xrkseek/core-session";
import { createToolRegistry } from "@xrkseek/core-tools";
import type { LlmAdapter } from "@xrkseek/llm";
import type { ChatMessage } from "@xrkseek/protocol";
import { runTurn } from "../src/index.js";

describe("systemPromptUpdate in-history", () => {
  it("appends a changed system prompt after cached history within a turn", async () => {
    const store = createMemorySessionStore();
    const session = store.create();
    const tools = createToolRegistry();
    const workspaceBlocks: string[] = [];
    const captured: ChatMessage[][] = [];

    tools.register({
      name: "bump_guidance",
      description: "Mutate assemble workspace for the next step",
      parameters: { type: "object", properties: {} },
      async execute() {
        workspaceBlocks.push("## Extra\nnew guidance");
        return { content: "bumped" };
      },
    });

    const llm: LlmAdapter = {
      id: "capture",
      systemPromptUpdate: "in-history",
      async chat(req) {
        captured.push(req.messages.map((m) => ({ ...m })));
        if (captured.length === 1) {
          return {
            content: "",
            toolCalls: [{ id: "c1", name: "bump_guidance", arguments: {} }],
          };
        }
        return { content: "done" };
      },
    };

    await runTurn({
      sessionId: session.id,
      userText: "first",
      store,
      llm,
      tools,
      assemble: {
        persona: "PersonaBase",
        workspaceBlocks,
      },
      now: (() => {
        let t = 0;
        return () => {
          t += 1;
          return t;
        };
      })(),
    });

    expect(captured).toHaveLength(2);
    const first = captured[0]!;
    const second = captured[1]!;
    expect(first[0]?.role).toBe("system");
    expect(String(first[0]?.content)).toContain("PersonaBase");
    expect(String(first[0]?.content)).not.toContain("new guidance");

    expect(second[0]?.role).toBe("system");
    expect(second[0]?.content).toBe(first[0]?.content);
    const trailingSystems = second.filter((m) => m.role === "system");
    expect(trailingSystems).toHaveLength(2);
    expect(String(trailingSystems[1]?.content)).toContain("new guidance");
    expect(String(second[0]?.content)).not.toContain("new guidance");
  });

  it("keeps leading rewrite when the adapter omits systemPromptUpdate", async () => {
    const store = createMemorySessionStore();
    const session = store.create();
    const tools = createToolRegistry();
    const workspaceBlocks: string[] = [];
    const captured: ChatMessage[][] = [];

    tools.register({
      name: "bump_guidance",
      description: "Mutate assemble workspace for the next step",
      parameters: { type: "object", properties: {} },
      async execute() {
        workspaceBlocks.push("## Extra\nnew guidance");
        return { content: "bumped" };
      },
    });

    const llm: LlmAdapter = {
      id: "capture",
      async chat(req) {
        captured.push(req.messages.map((m) => ({ ...m })));
        if (captured.length === 1) {
          return {
            content: "",
            toolCalls: [{ id: "c1", name: "bump_guidance", arguments: {} }],
          };
        }
        return { content: "done" };
      },
    };

    await runTurn({
      sessionId: session.id,
      userText: "first",
      store,
      llm,
      tools,
      assemble: {
        persona: "PersonaBase",
        workspaceBlocks,
      },
      now: (() => {
        let t = 0;
        return () => {
          t += 1;
          return t;
        };
      })(),
    });

    expect(captured).toHaveLength(2);
    const second = captured[1]!;
    expect(second.filter((m) => m.role === "system")).toHaveLength(1);
    expect(String(second[0]?.content)).toContain("new guidance");
  });
});
