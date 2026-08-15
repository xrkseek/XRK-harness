import { describe, expect, it } from "vitest";
import { createMemorySessionStore, deriveMessages } from "@xrkseek/core-session";
import { createToolRegistry } from "@xrkseek/core-tools";
import type { LlmAdapter } from "@xrkseek/llm";
import {
  MAX_STEPS_PROMPT,
  MAX_STEPS_TOOL_DISABLED,
  runTurn,
} from "../src/index.js";

describe("runTurn maxSteps", () => {
  it("disables tools on last step and injects notice", async () => {
    const toolRequests: unknown[] = [];
    let n = 0;
    const llm: LlmAdapter = {
      async chat(req) {
        toolRequests.push(req.tools ?? []);
        n += 1;
        if (n === 1) {
          return {
            content: "",
            toolCalls: [{ id: "c1", name: "echo", arguments: { text: "a" } }],
          };
        }
        return {
          content: "summary",
          toolCalls: [{ id: "c2", name: "echo", arguments: { text: "b" } }],
        };
      },
    };
    const store = createMemorySessionStore();
    const session = store.create();
    const tools = createToolRegistry();
    let executed = 0;
    tools.register({
      name: "echo",
      description: "echo",
      parameters: { type: "object" },
      async execute() {
        executed += 1;
        return { content: "ok" };
      },
    });

    const result = await runTurn({
      sessionId: session.id,
      userText: "go",
      store,
      llm,
      tools,
      maxSteps: 2,
    });

    expect(result.steps).toBe(2);
    expect(result.assistantText).toBe("summary");
    expect(executed).toBe(1);
    expect(toolRequests[0]).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "echo" })]),
    );
    expect(toolRequests[1]).toEqual([]);
    const msgs = deriveMessages(store.get(session.id).events);
    expect(msgs.some((m) => m.content === MAX_STEPS_PROMPT)).toBe(true);
    expect(
      msgs.some(
        (m) => m.role === "tool" && m.content === MAX_STEPS_TOOL_DISABLED,
      ),
    ).toBe(true);
    expect(result.toolFailed).toBe(1);
    expect(result.toolOk).toBe(1);
  });
});
