/**
 * DSH theorem (request-reconstruction): every loop-built request is a pure
 * function of the session-log prefix at dispatch. Learn from
 * deepseek-harness `request-reconstruction.spec.ts` + agent-loop invariant.
 */
import { describe, expect, it } from "vitest";
import {
  createMemorySessionStore,
  deriveMessages,
  durableModelHistory,
  foldRequestHeader,
} from "@xrkseek/core-session";
import { createToolRegistry } from "@xrkseek/core-tools";
import type { LlmChatRequest } from "@xrkseek/llm";
import { createReplayAdapter } from "@xrkseek/llm-replay";
import { createRoutingLlmAdapter } from "@xrkseek/llm-registry";
import type { ChatMessage } from "@xrkseek/protocol";
import { runTurn } from "../src/index.js";

type Captured = {
  readonly messages: ChatMessage[];
  readonly tools: LlmChatRequest["tools"];
  readonly prefixLen: number;
};

function expectPrefixExtension(
  previous: readonly ChatMessage[],
  current: readonly ChatMessage[],
): void {
  expect(current.length).toBeGreaterThan(previous.length);
  expect(current.slice(0, previous.length)).toEqual([...previous]);
}

describe("request reconstruction from session log (DSH)", () => {
  it("THEOREM: each step rebuilds byte-equal from the dispatch-time log prefix", async () => {
    const store = createMemorySessionStore();
    const session = store.create();
    const tools = createToolRegistry();
    tools.register({
      name: "echo",
      description: "echo back",
      parameters: {
        type: "object",
        properties: { text: { type: "string" } },
      },
      async execute(args) {
        return { content: `echo: ${String((args as { text?: string }).text)}` };
      },
    });

    const captured: Captured[] = [];
    const inner = createReplayAdapter([
      {
        content: "calling",
        toolCalls: [{ id: "c1", name: "echo", arguments: { text: "one" } }],
      },
      { content: "done" },
      { content: "turn-two" },
    ]);
    const capturing = {
      id: "capture",
      async chat(req: LlmChatRequest) {
        captured.push({
          messages: structuredClone(req.messages) as ChatMessage[],
          tools: req.tools ? structuredClone(req.tools) : undefined,
          prefixLen: store.get(session.id).events.length,
        });
        return inner.chat(req);
      },
    };
    const llm = createRoutingLlmAdapter({
      id: "route",
      getSelection: () => ({ provider: "mock", model: "mock-v1" }),
      resolveAdapter: () => capturing,
    });

    await runTurn({
      sessionId: session.id,
      userText: "go",
      store,
      llm,
      tools,
      system: "stable base",
      now: (() => {
        let t = 1000;
        return () => {
          t += 1;
          return t;
        };
      })(),
    });
    await runTurn({
      sessionId: session.id,
      userText: "again",
      store,
      llm,
      tools,
      system: "stable base",
      now: (() => {
        let t = 2000;
        return () => {
          t += 1;
          return t;
        };
      })(),
    });

    expect(captured).toHaveLength(3);
    const events = store.get(session.id).events;
    expect(events.filter((e) => e.type === "step/start")).toHaveLength(3);

    for (const snap of captured) {
      const prefix = events.slice(0, snap.prefixLen);
      expect(durableModelHistory(snap.messages)).toEqual(deriveMessages(prefix));

      const header = foldRequestHeader(prefix);
      expect(header?.config).toEqual({ provider: "mock", model: "mock-v1" });
      expect(header?.system).toBe("stable base");
      expect(header?.tools).toEqual(snap.tools);
      expect(prefix.some((e) => e.type === "step/start")).toBe(true);
      expect(prefix.some((e) => e.type === "request/header")).toBe(true);
    }

    expectPrefixExtension(
      durableModelHistory(captured[0]!.messages),
      durableModelHistory(captured[1]!.messages),
    );
    expectPrefixExtension(
      durableModelHistory(captured[1]!.messages),
      durableModelHistory(captured[2]!.messages),
    );
  });

  it("rejects a phantom history that is not in the log (assertModelVisible)", async () => {
    const store = createMemorySessionStore();
    const session = store.create();
    store.append(session.id, {
      type: "turn/start",
      ts: 1,
      turnId: "t1",
    });
    store.append(session.id, {
      type: "user/message",
      ts: 2,
      turnId: "t1",
      content: "hi",
    });
    const events = store.get(session.id).events;
    const derived = deriveMessages(events);
    expect(derived).toEqual([{ role: "user", content: "hi" }]);

    const { assertModelVisible, ModelVisibleInvariantError } = await import(
      "@xrkseek/core-session"
    );
    expect(() => assertModelVisible(events, derived)).not.toThrow();
    expect(() =>
      assertModelVisible(events, [
        ...derived,
        { role: "user", content: "phantom" },
      ]),
    ).toThrow(ModelVisibleInvariantError);
  });
});
