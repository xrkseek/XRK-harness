import { describe, expect, it } from "vitest";
import {
  createAgent,
  SessionSafetyLimitError,
} from "../src/index.js";
import { createMemorySessionStore, deriveMessages } from "@xrkseek/core-session";
import { createToolRegistry, type ToolDefinition } from "@xrkseek/core-tools";
import type { LlmAdapter } from "@xrkseek/llm";

const echo: ToolDefinition = {
  name: "echo",
  description: "echo",
  parameters: {
    type: "object",
    properties: { text: { type: "string" } },
  },
  async execute(args) {
    return { content: String((args as { text?: string }).text ?? "") };
  },
};

const failTool: ToolDefinition = {
  name: "fail",
  description: "always fails",
  parameters: { type: "object", properties: {} },
  async execute() {
    return { content: "boom", isError: true };
  },
};

describe("session safety on agent", () => {
  it("soft-injects typed safety/notice after repeated identical tools", async () => {
    let calls = 0;
    const llm: LlmAdapter = {
      async chat() {
        calls += 1;
        if (calls === 1) {
          return {
            content: "t1",
            toolCalls: [
              { id: "c1", name: "echo", arguments: { text: "same" } },
              { id: "c2", name: "echo", arguments: { text: "same" } },
              { id: "c3", name: "echo", arguments: { text: "same" } },
            ],
          };
        }
        return { content: "done", toolCalls: [] };
      },
    };
    const store = createMemorySessionStore();
    const session = store.create("safe-soft");
    const tools = createToolRegistry();
    tools.register(echo);
    const agent = createAgent({
      sessionId: session.id,
      store,
      llm,
      tools,
      safety: { loopDetection: { softThreshold: 3, hardThreshold: 10 } },
    });
    await agent.continueTurn({ text: "go" });
    const events = store.get(session.id).events;
    const notice = events.find((e) => e.type === "safety/notice");
    expect(notice).toMatchObject({
      type: "safety/notice",
      kind: "loop_soft",
      toolName: "echo",
      count: 3,
    });
    const msgs = deriveMessages(events);
    expect(
      msgs.some(
        (m) =>
          m.role === "user" && String(m.content).includes("Repeated identical"),
      ),
    ).toBe(true);
  });

  it("hard loop writes safety/notice once and throws SessionSafetyLimitError", async () => {
    const llm: LlmAdapter = {
      async chat() {
        return {
          content: "t",
          toolCalls: [
            { id: "c1", name: "echo", arguments: { text: "x" } },
            { id: "c2", name: "echo", arguments: { text: "x" } },
          ],
        };
      },
    };
    const store = createMemorySessionStore();
    const session = store.create("safe-hard");
    const tools = createToolRegistry();
    tools.register(echo);
    const agent = createAgent({
      sessionId: session.id,
      store,
      llm,
      tools,
      safety: { loopDetection: { softThreshold: 10, hardThreshold: 2 } },
    });
    await expect(agent.continueTurn({ text: "go" })).rejects.toBeInstanceOf(
      SessionSafetyLimitError,
    );
    const notices = store
      .get(session.id)
      .events.filter((e) => e.type === "safety/notice" && e.kind === "loop_hard");
    expect(notices).toHaveLength(1);
  });

  it("stops after consecutive all-fail turns with mistake_limit notice", async () => {
    const llm: LlmAdapter = {
      async chat() {
        return {
          content: "x",
          toolCalls: [{ id: "c", name: "fail", arguments: {} }],
        };
      },
    };
    const store = createMemorySessionStore();
    const session = store.create("safe-mist");
    const tools = createToolRegistry();
    tools.register(failTool);
    const agent = createAgent({
      sessionId: session.id,
      store,
      llm,
      tools,
      maxSteps: 1,
      safety: {
        loopDetection: false,
        mistake: { maxConsecutiveMistakes: 2 },
      },
    });
    await agent.continueTurn({ text: "1" });
    await expect(agent.continueTurn({ text: "2" })).rejects.toBeInstanceOf(
      SessionSafetyLimitError,
    );
    expect(
      store
        .get(session.id)
        .events.some(
          (e) => e.type === "safety/notice" && e.kind === "mistake_limit",
        ),
    ).toBe(true);
  });
});
