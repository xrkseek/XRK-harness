import { describe, expect, it } from "vitest";
import { createMemorySessionStore, deriveMessages } from "@xrkseek/core-session";
import { createToolRegistry } from "@xrkseek/core-tools";
import { createReplayAdapter } from "@xrkseek/llm-replay";
import { runTurn } from "../src/index.js";
import { settleToolBatch } from "../src/settle-batch.js";
import { materializeTools } from "@xrkseek/core-tools";

function delay(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

describe("settleToolBatch", () => {
  it("parallel preserves call order even when later call finishes first", async () => {
    const tools = createToolRegistry();
    const started: string[] = [];
    const finished: string[] = [];
    tools.register({
      name: "slow",
      description: "slow",
      parameters: {},
      async execute() {
        started.push("slow");
        await delay(40);
        finished.push("slow");
        return { content: "slow-done" };
      },
    });
    tools.register({
      name: "fast",
      description: "fast",
      parameters: {},
      async execute() {
        started.push("fast");
        await delay(5);
        finished.push("fast");
        return { content: "fast-done" };
      },
    });
    const materialization = materializeTools(tools);
    const calls = [
      { id: "1", name: "slow", arguments: {} },
      { id: "2", name: "fast", arguments: {} },
    ];

    const t0 = Date.now();
    const { outcomes, mode } = await settleToolBatch({
      calls,
      registry: tools,
      materialization,
      mode: "parallel",
    });
    const elapsed = Date.now() - t0;

    expect(mode).toBe("parallel");
    expect(outcomes.map((o) => o.result.content)).toEqual([
      "slow-done",
      "fast-done",
    ]);
    // fast finishes before slow, but both overlapped
    expect(finished[0]).toBe("fast");
    expect(finished).toContain("slow");
    // Overlap: wall time closer to max(delays) than sum
    expect(elapsed).toBeLessThan(100);
  });

  it("serial runs one after another", async () => {
    const tools = createToolRegistry();
    const order: string[] = [];
    tools.register({
      name: "a",
      description: "a",
      parameters: {},
      async execute() {
        order.push("a-start");
        await delay(15);
        order.push("a-end");
        return { content: "a" };
      },
    });
    tools.register({
      name: "b",
      description: "b",
      parameters: {},
      async execute() {
        order.push("b-start");
        await delay(5);
        order.push("b-end");
        return { content: "b" };
      },
    });
    const materialization = materializeTools(tools);
    await settleToolBatch({
      calls: [
        { id: "1", name: "a", arguments: {} },
        { id: "2", name: "b", arguments: {} },
      ],
      registry: tools,
      materialization,
      mode: "serial",
    });
    expect(order).toEqual(["a-start", "a-end", "b-start", "b-end"]);
  });
});

describe("runTurn parallel settle", () => {
  it("appends all calls before any result; results follow call order", async () => {
    const store = createMemorySessionStore();
    const session = store.create();
    const tools = createToolRegistry();
    tools.register({
      name: "slow",
      description: "slow",
      parameters: {},
      async execute() {
        await delay(30);
        return { content: "S" };
      },
    });
    tools.register({
      name: "fast",
      description: "fast",
      parameters: {},
      async execute() {
        await delay(5);
        return { content: "F" };
      },
    });
    const llm = createReplayAdapter([
      {
        content: "",
        toolCalls: [
          { id: "c1", name: "slow", arguments: {} },
          { id: "c2", name: "fast", arguments: {} },
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
      toolSettle: "parallel",
    });

    const types = store.get(session.id).events.map((e) => e.type);
    const callIdx = types.indexOf("tool/call");
    const resultIdx = types.indexOf("tool/result");
    expect(callIdx).toBeGreaterThan(-1);
    expect(resultIdx).toBeGreaterThan(callIdx);
    // both calls before first result
    const firstResult = types.indexOf("tool/result");
    const callCountBefore = types
      .slice(0, firstResult)
      .filter((t) => t === "tool/call").length;
    expect(callCountBefore).toBe(2);

    const msgs = deriveMessages(store.get(session.id).events);
    const toolMsgs = msgs.filter((m) => m.role === "tool");
    expect(toolMsgs.map((m) => m.content)).toEqual(["S", "F"]);
  });
});
