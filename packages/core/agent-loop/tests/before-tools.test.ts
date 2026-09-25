import { describe, expect, it } from "vitest";
import { createMemorySessionStore } from "@xrkseek/core-session";
import { createToolRegistry } from "@xrkseek/core-tools";
import { createReplayAdapter } from "@xrkseek/llm-replay";
import { runTurn } from "../src/index.js";

describe("runTurn beforeTools", () => {
  it("skips beforeTools on a text-only turn", async () => {
    const store = createMemorySessionStore();
    const session = store.create();
    let called = 0;
    await runTurn({
      sessionId: session.id,
      userText: "ping",
      store,
      llm: createReplayAdapter([{ content: "pong" }]),
      tools: createToolRegistry(),
      beforeTools: () => {
        called += 1;
      },
    });
    expect(called).toBe(0);
  });

  it("awaits beforeTools before settling tool calls", async () => {
    const store = createMemorySessionStore();
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
    await runTurn({
      sessionId: session.id,
      userText: "go",
      store,
      llm: createReplayAdapter([
        {
          content: "",
          toolCalls: [{ id: "c1", name: "echo", arguments: {} }],
        },
        { content: "done" },
      ]),
      tools,
      beforeTools: async () => {
        order.push("beforeTools");
      },
    });
    expect(order[0]).toBe("beforeTools");
    expect(order).toContain("execute");
  });
});
