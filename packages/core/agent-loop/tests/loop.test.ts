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
});
