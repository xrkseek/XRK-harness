import { describe, expect, it } from "vitest";
import { createMemorySessionStore, deriveMessages } from "@xrkseek/core-session";
import { createStdTools, createToolRegistry } from "@xrkseek/core-tools";
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

  it("ends turn error on EMPTY_RESPONSE", async () => {
    const store = createMemorySessionStore();
    const session = store.create();
    const tools = createToolRegistry();
    const llm = createReplayAdapter([{ content: "" }]);

    await expect(
      runTurn({
        sessionId: session.id,
        userText: "hi",
        store,
        llm,
        tools,
        llmRetry: false,
      }),
    ).rejects.toMatchObject({ name: "EmptyResponseError" });

    const end = store.get(session.id).events.find((e) => e.type === "turn/end");
    expect(end).toMatchObject({
      type: "turn/end",
      reason: {
        kind: "error",
        error: { code: "EMPTY_RESPONSE" },
      },
    });
  });

  it("ends turn max-tokens and drops truncated tool calls", async () => {
    const store = createMemorySessionStore();
    const session = store.create();
    const tools = createToolRegistry();
    let executed = 0;
    tools.register({
      name: "echo",
      description: "e",
      parameters: { type: "object" },
      async execute() {
        executed += 1;
        return { content: "should-not-run" };
      },
    });
    const llm = createReplayAdapter([
      {
        content: "partial",
        finishReason: "max-tokens",
        toolCalls: [{ id: "c1", name: "echo", arguments: {} }],
      },
    ]);

    const result = await runTurn({
      sessionId: session.id,
      userText: "hi",
      store,
      llm,
      tools,
    });

    expect(result.assistantText).toBe("partial");
    expect(executed).toBe(0);
    const events = store.get(session.id).events;
    expect(events.some((e) => e.type === "tool/call")).toBe(false);
    const end = events.find((e) => e.type === "turn/end");
    expect(end).toMatchObject({ type: "turn/end", reason: { kind: "max-tokens" } });
    expect(deriveMessages(events)).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "partial" },
    ]);
  });

  it("forwards assemble.toolOrder onto the LLM tools list", async () => {
    const store = createMemorySessionStore();
    const session = store.create();
    const tools = createToolRegistry();
    tools.register({
      name: "zeta",
      description: "z",
      parameters: { type: "object" },
      async execute() {
        return { content: "z" };
      },
    });
    tools.register({
      name: "alpha",
      description: "a",
      parameters: { type: "object" },
      async execute() {
        return { content: "a" };
      },
    });
    const llm = createReplayAdapter([{ content: "ok" }]);
    const seen: string[][] = [];
    const orig = llm.chat.bind(llm);
    llm.chat = async (req) => {
      seen.push((req.tools ?? []).map((t) => t.name));
      return orig(req);
    };

    await runTurn({
      sessionId: session.id,
      userText: "hi",
      store,
      llm,
      tools,
      assemble: {
        persona: "P",
        toolOrder: ["zeta", " "],
      },
    });

    expect(seen[0]).toEqual(["zeta", "alpha"]);
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

  it("passbacks reasoning on every reasoned assistant when calling LLM again (rc.8)", async () => {
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
        reasoning: "need echo",
        toolCalls: [
          { id: "c1", name: "echo", arguments: { text: "hi" } },
        ],
      },
      { content: "done", reasoning: "plain CoT" },
      { content: "follow" },
    ]);
    const seen: unknown[] = [];
    const orig = llm.chat.bind(llm);
    llm.chat = async (req) => {
      seen.push(req.messages);
      return orig(req);
    };

    await runTurn({
      sessionId: session.id,
      userText: "go",
      store,
      llm,
      tools,
    });
    // Second turn to force another LLM call that replays the plain CoT turn.
    await runTurn({
      sessionId: session.id,
      userText: "again",
      store,
      llm,
      tools,
    });

    expect(seen.length).toBeGreaterThanOrEqual(3);
    const second = seen[1] as Array<{
      role: string;
      reasoning?: string;
      toolCalls?: unknown;
    }>;
    const assistantWithTools = second.find(
      (m) => m.role === "assistant" && m.toolCalls,
    );
    expect(assistantWithTools?.reasoning).toBe("need echo");
    const third = seen[2] as Array<{ role: string; reasoning?: string }>;
    const plain = third.find(
      (m) => m.role === "assistant" && m.reasoning === "plain CoT",
    );
    expect(plain?.reasoning).toBe("plain CoT");
  });

  it("appends todo/write before tool/result; deriveMessages skips it", async () => {
    const store = createMemorySessionStore();
    const session = store.create();
    const tools = createToolRegistry();
    for (const t of createStdTools()) tools.register(t);
    const llm = createReplayAdapter([
      {
        content: "",
        toolCalls: [
          {
            id: "c1",
            name: "todo_write",
            arguments: {
              todos: [{ id: "1", content: "ship", status: "in_progress" }],
            },
          },
        ],
      },
      { content: "ok" },
    ]);

    await runTurn({
      sessionId: session.id,
      userText: "plan",
      store,
      llm,
      tools,
    });

    const types = store.get(session.id).events.map((e) => e.type);
    const writeAt = types.lastIndexOf("todo/write");
    const resultAt = types.lastIndexOf("tool/result");
    expect(writeAt).toBeGreaterThan(-1);
    expect(resultAt).toBeGreaterThan(writeAt);
    const write = store.get(session.id).events[writeAt];
    expect(write).toMatchObject({
      type: "todo/write",
      todos: [{ content: "ship", status: "in_progress" }],
    });
    expect(deriveMessages(store.get(session.id).events).map((m) => m.role)).toEqual(
      ["user", "assistant", "tool", "assistant"],
    );
  });

  it("commits queued /plan at the next step and injects plan policy", async () => {
    const store = createMemorySessionStore();
    const session = store.create();
    store.append(session.id, {
      type: "turn/start",
      ts: 1,
      turnId: "open",
    });
    store.append(session.id, {
      type: "command/run",
      ts: 2,
      commandId: "cmd_plan",
      name: "plan",
      args: "",
      source: { kind: "user" },
    });
    store.append(session.id, {
      type: "turn/end",
      ts: 3,
      turnId: "open",
      reason: { kind: "completed" },
    });

    const captured: string[] = [];
    const llm = createReplayAdapter([{ content: "ok" }]);
    const orig = llm.chat.bind(llm);
    llm.chat = async (req) => {
      const sys = req.messages.find((m) => m.role === "system");
      captured.push(typeof sys?.content === "string" ? sys.content : "");
      return orig(req);
    };

    await runTurn({
      sessionId: session.id,
      userText: "go",
      store,
      llm,
      tools: createToolRegistry(),
    });

    const types = store.get(session.id).events.map((e) => e.type);
    const modeAt = types.lastIndexOf("plan/mode");
    const stepAt = types.lastIndexOf("step/start");
    expect(modeAt).toBeGreaterThan(-1);
    expect(stepAt).toBeGreaterThan(modeAt);
    expect(captured.some((s) => s.includes("plan mode"))).toBe(true);
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

  it("streams reasoning-delta chunks before assistant/message", async () => {
    const store = createMemorySessionStore();
    const session = store.create();
    const llm = createReplayAdapter(
      [{ content: "pong", reasoning: "think hard" }],
      { enableStream: true },
    );

    await runTurn({
      sessionId: session.id,
      userText: "ping",
      store,
      llm,
      tools: createToolRegistry(),
    });

    const events = store.get(session.id).events;
    const chunks = events.filter((e) => e.type === "assistant/chunk");
    const message = events.find((e) => e.type === "assistant/message");
    const reasoningChunks = chunks.filter(
      (e) => e.type === "assistant/chunk" && e.kind === "reasoning",
    );
    expect(reasoningChunks.length).toBeGreaterThanOrEqual(2);
    expect(message?.type).toBe("assistant/message");
    if (message?.type === "assistant/message") {
      expect(message.reasoning).toBe("think hard");
      expect(message.content).toBe("pong");
    }
    const firstReasoning = events.findIndex(
      (e) => e.type === "assistant/chunk" && e.kind === "reasoning",
    );
    const messageIdx = events.findIndex((e) => e.type === "assistant/message");
    expect(firstReasoning).toBeGreaterThan(-1);
    expect(firstReasoning).toBeLessThan(messageIdx);
  });

  it("persists assistant/message.usage from replay stream", async () => {
    const store = createMemorySessionStore();
    const session = store.create();
    const llm = createReplayAdapter(
      [
        {
          content: "pong",
          usage: { inputTokens: 9, outputTokens: 2 },
        },
      ],
      { enableStream: true },
    );

    await runTurn({
      sessionId: session.id,
      userText: "ping",
      store,
      llm,
      tools: createToolRegistry(),
    });

    const message = store
      .get(session.id)
      .events.find((e) => e.type === "assistant/message");
    expect(message).toMatchObject({
      type: "assistant/message",
      usage: { inputTokens: 9, outputTokens: 2 },
    });
    const usageChunk = store
      .get(session.id)
      .events.find(
        (e) => e.type === "assistant/chunk" && e.kind === "usage",
      );
    expect(usageChunk).toMatchObject({
      type: "assistant/chunk",
      kind: "usage",
      usage: { inputTokens: 9, outputTokens: 2 },
    });
  });

  it("passes image blocks when adapter declares image modality", async () => {
    const store = createMemorySessionStore();
    const session = store.create();
    const png = new Uint8Array([1, 2, 3]);
    let sawImage = false;
    const llm = {
      id: "vision",
      inputModalities: ["text", "image"] as const,
      async chat(req: {
        messages: readonly { role: string; content: unknown }[];
        resolveImage?: (id: string) => Promise<{ mediaType: string; data: Uint8Array }>;
      }) {
        const user = req.messages.find((m) => m.role === "user");
        expect(Array.isArray(user?.content)).toBe(true);
        const bytes = await req.resolveImage?.("sha256:ab");
        expect(bytes?.data).toEqual(png);
        sawImage = true;
        return { content: "saw" };
      },
    };

    const result = await runTurn({
      sessionId: session.id,
      userText: "see",
      userContent: [
        { type: "text", text: "see" },
        {
          type: "image",
          attachment: {
            attachmentId: "sha256:ab",
            mediaType: "image/png",
            bytes: 3,
            width: 1,
            height: 1,
          },
        },
      ],
      store,
      llm,
      tools: createToolRegistry(),
      resolveImage: async () => ({ mediaType: "image/png", data: png }),
    });
    expect(result.assistantText).toBe("saw");
    expect(sawImage).toBe(true);
  });

  it("ends the turn when a tool returns concludesTurn (DSH)", async () => {
    const store = createMemorySessionStore();
    const session = store.create();
    const tools = createToolRegistry();
    tools.register({
      name: "finish",
      description: "finish",
      parameters: { type: "object" },
      async execute() {
        return { content: "done", concludesTurn: true };
      },
    });
    const llm = createReplayAdapter([
      {
        content: "",
        toolCalls: [{ id: "c1", name: "finish", arguments: {} }],
      },
      { content: "should-not-run" },
    ]);
    const result = await runTurn({
      sessionId: session.id,
      userText: "go",
      store,
      llm,
      tools,
    });
    expect(result.assistantText).toBe("");
    expect(result.steps).toBe(1);
    expect(result.toolOk).toBe(1);
    const end = store.get(session.id).events.find((e) => e.type === "turn/end");
    expect(end).toMatchObject({
      type: "turn/end",
      reason: { kind: "completed" },
    });
    const msgs = deriveMessages(store.get(session.id).events);
    expect(msgs.some((m) => m.role === "assistant" && m.content === "should-not-run")).toBe(false);
    expect(msgs.some((m) => m.role === "tool" && m.content === "done")).toBe(true);
  });
});
