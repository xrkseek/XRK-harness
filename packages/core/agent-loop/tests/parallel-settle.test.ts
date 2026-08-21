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
      isConcurrencySafe: () => true,
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
      isConcurrencySafe: () => true,
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

  it("maxParallel caps concurrent settles", async () => {
    const tools = createToolRegistry();
    let live = 0;
    let peak = 0;
    tools.register({
      name: "work",
      description: "work",
      parameters: {},
      isConcurrencySafe: () => true,
      async execute() {
        live += 1;
        peak = Math.max(peak, live);
        await delay(25);
        live -= 1;
        return { content: "ok" };
      },
    });
    const materialization = materializeTools(tools);
    await settleToolBatch({
      calls: [
        { id: "1", name: "work", arguments: {} },
        { id: "2", name: "work", arguments: {} },
        { id: "3", name: "work", arguments: {} },
      ],
      registry: tools,
      materialization,
      mode: "parallel",
      maxParallel: 2,
    });
    expect(peak).toBeLessThanOrEqual(2);
  });

  it("exclusive tools barrier between parallel groups", async () => {
    const tools = createToolRegistry();
    const order: string[] = [];
    tools.register({
      name: "read",
      description: "read",
      parameters: {},
      isConcurrencySafe: () => true,
      async execute(args) {
        const id = String((args as { id?: string }).id ?? "");
        order.push(`read-${id}-start`);
        await delay(20);
        order.push(`read-${id}-end`);
        return { content: id };
      },
    });
    tools.register({
      name: "write",
      description: "write",
      parameters: {},
      async execute() {
        order.push("write-start");
        await delay(5);
        order.push("write-end");
        return { content: "w" };
      },
    });
    const materialization = materializeTools(tools);
    await settleToolBatch({
      calls: [
        { id: "1", name: "read", arguments: { id: "a" } },
        { id: "2", name: "read", arguments: { id: "b" } },
        { id: "3", name: "write", arguments: {} },
        { id: "4", name: "read", arguments: { id: "c" } },
      ],
      registry: tools,
      materialization,
      mode: "parallel",
    });
    // Two reads overlap before write; write is exclusive; third read after.
    expect(order.indexOf("write-start")).toBeGreaterThan(
      order.indexOf("read-a-end"),
    );
    expect(order.indexOf("write-start")).toBeGreaterThan(
      order.indexOf("read-b-end"),
    );
    expect(order.indexOf("read-c-start")).toBeGreaterThan(
      order.indexOf("write-end"),
    );
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
      isConcurrencySafe: () => true,
      async execute() {
        await delay(30);
        return { content: "S" };
      },
    });
    tools.register({
      name: "fast",
      description: "fast",
      parameters: {},
      isConcurrencySafe: () => true,
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

describe("settleToolBatch abort (DSH ABORTED / ABORTED_BEFORE_DISPATCH)", () => {
  it("marks mid-body cancel as ABORTED and never-started as ABORTED_BEFORE_DISPATCH", async () => {
    const tools = createToolRegistry();
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    tools.register({
      name: "slow",
      description: "slow",
      parameters: {},
      isConcurrencySafe: () => true,
      async execute(_args, signal) {
        await gate;
        if (signal?.aborted) throw new DOMException("aborted", "AbortError");
        return { content: "slow-ok" };
      },
    });
    tools.register({
      name: "later",
      description: "later",
      parameters: {},
      isConcurrencySafe: () => true,
      async execute() {
        return { content: "should-not-run" };
      },
    });
    const materialization = materializeTools(tools);
    const ac = new AbortController();
    const pending = settleToolBatch({
      calls: [
        { id: "1", name: "slow", arguments: {} },
        { id: "2", name: "later", arguments: {} },
      ],
      registry: tools,
      materialization,
      mode: "parallel",
      maxParallel: 1,
      signal: ac.signal,
    });
    await delay(10);
    ac.abort();
    release();
    const { outcomes, aborted } = await pending;
    expect(aborted).toBe(true);
    expect(outcomes).toHaveLength(2);
    expect(outcomes[0]?.result.error?.code).toBe("ABORTED");
    expect(String(outcomes[0]?.result.content)).toMatch(/^Error: tool call aborted$/);
    expect(outcomes[0]?.skippedBody).toBeFalsy();
    expect(outcomes[1]?.result.isError).toBe(true);
    expect(outcomes[1]?.result.error?.code).toBe("ABORTED_BEFORE_DISPATCH");
    expect(String(outcomes[1]?.result.content)).toMatch(/aborted before dispatch/i);
    expect(outcomes[1]?.skippedBody).toBe(true);
  });

  it("supersedes late success with ABORTED when cancel wins after body returns", async () => {
    const tools = createToolRegistry();
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    tools.register({
      name: "late",
      description: "late",
      parameters: {},
      async execute(_args, signal) {
        await gate;
        // Body ignores abort and returns success; pipeline must still ABORT.
        void signal;
        return { content: "should-be-superseded" };
      },
    });
    const materialization = materializeTools(tools);
    const ac = new AbortController();
    const pending = settleToolBatch({
      calls: [{ id: "1", name: "late", arguments: {} }],
      registry: tools,
      materialization,
      mode: "serial",
      signal: ac.signal,
    });
    await delay(10);
    ac.abort();
    release();
    const { outcomes, aborted } = await pending;
    expect(aborted).toBe(true);
    expect(outcomes[0]?.result.error?.code).toBe("ABORTED");
    expect(outcomes[0]?.result.content).toBe("Error: tool call aborted");
  });
});
