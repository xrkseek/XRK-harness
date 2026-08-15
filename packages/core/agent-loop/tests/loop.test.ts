import { describe, expect, it } from "vitest";
import { createMemorySessionStore, deriveMessages } from "@xrkseek/core-session";
import { createToolRegistry } from "@xrkseek/core-tools";
import { createReplayAdapter } from "@xrkseek/llm-replay";
import { runTurn } from "../src/index.js";

describe("runTurn", () => {
  it("completes a text-only turn with reconstructible history", async () => {
    const store = createMemorySessionStore();
    const session = store.create();
    const tools = createToolRegistry();
    const llm = createReplayAdapter([{ content: "pong" }]);

    const result = await runTurn({
      sessionId: session.id,
      userText: "ping",
      store,
      llm,
      tools,
      now: (() => {
        let t = 0;
        return () => {
          t += 1;
          return t;
        };
      })(),
    });

    expect(result.assistantText).toBe("pong");
    expect(result.steps).toBe(1);
    const msgs = deriveMessages(store.get(session.id).events);
    expect(msgs).toEqual([
      { role: "user", content: "ping" },
      { role: "assistant", content: "pong" },
    ]);
  });

  it("runs one tool then final answer", async () => {
    const store = createMemorySessionStore();
    const session = store.create();
    const tools = createToolRegistry();
    tools.register({
      name: "echo",
      description: "echo",
      parameters: { type: "object" },
      async execute(args) {
        return { content: String((args as { text?: string }).text ?? "") };
      },
    });
    const llm = createReplayAdapter([
      {
        content: "",
        toolCalls: [
          { id: "c1", name: "echo", arguments: { text: "hi" } },
        ],
      },
      { content: "done" },
    ]);

    const result = await runTurn({
      sessionId: session.id,
      userText: "go",
      store,
      llm,
      tools,
    });

    expect(result.assistantText).toBe("done");
    expect(result.steps).toBe(2);
    const roles = deriveMessages(store.get(session.id).events).map((m) => m.role);
    expect(roles).toEqual(["user", "assistant", "tool", "assistant"]);
  });

  it("respects abort signal", async () => {
    const store = createMemorySessionStore();
    const session = store.create();
    const ac = new AbortController();
    ac.abort();
    await expect(
      runTurn({
        sessionId: session.id,
        userText: "x",
        store,
        llm: createReplayAdapter([{ content: "no" }]),
        tools: createToolRegistry(),
        signal: ac.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
