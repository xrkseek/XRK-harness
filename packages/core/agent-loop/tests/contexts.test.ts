import { describe, expect, it } from "vitest";
import { createMemorySessionStore, deriveMessages } from "@xrkseek/core-session";
import {
  addAdditionalContext,
  createToolPipeline,
  createToolRegistry,
} from "@xrkseek/core-tools";
import { createReplayAdapter } from "@xrkseek/llm-replay";
import { runTurn } from "../src/index.js";

describe("runTurn batch contexts", () => {
  it("injects additionalContexts as user/message after all tool results", async () => {
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
    const pipeline = createToolPipeline();
    pipeline.onPost(async (ctx) => {
      addAdditionalContext(ctx, "extra-1");
      addAdditionalContext(ctx, "extra-2");
      return { action: "accept" };
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

    await runTurn({
      sessionId: session.id,
      userText: "go",
      store,
      llm,
      tools,
      pipeline,
    });

    const msgs = deriveMessages(store.get(session.id).events);
    const roles = msgs.map((m) => m.role);
    // user, assistant(tool_calls), tool, user(extra-1), user(extra-2), assistant(done)
    expect(roles).toEqual([
      "user",
      "assistant",
      "tool",
      "user",
      "user",
      "assistant",
    ]);
    expect(msgs[3]?.content).toBe("extra-1");
    expect(msgs[4]?.content).toBe("extra-2");
  });
});
