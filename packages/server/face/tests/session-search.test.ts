import { describe, expect, it } from "vitest";
import {
  createMemorySessionStore,
  newSession,
} from "@xrkseek/core-session";
import { createProviderRegistry } from "@xrkseek/llm-registry";
import { createFaceRuntime } from "../src/runtime.js";
import { dispatchFaceMethod } from "../src/dispatch.js";
import {
  SESSION_SEARCH_RESULT_LIMIT,
  searchSessions,
} from "../src/session-search.js";

function bareRuntime(store = createMemorySessionStore()) {
  return createFaceRuntime({
    store,
    workspaceRoot: process.cwd(),
    version: "test",
    registry: createProviderRegistry(),
    drain: {
      wake: () => {},
      cancel: () => {},
      isActive: () => false,
    },
    resolveAgent: async () => {
      throw new Error("unused");
    },
  });
}

describe("session.search", () => {
  it("rejects empty / NUL / missing query", async () => {
    const runtime = bareRuntime();
    for (const payload of [{}, { query: "" }, { query: "   " }, { query: "a\0b" }]) {
      const res = await dispatchFaceMethod(runtime, "session.search", "q1", payload);
      expect(res.result.ok).toBe(false);
      if (!res.result.ok) {
        expect(res.result.error.code).toBe("invalid-payload");
      }
    }
  });

  it("finds user/message and assistant/message", async () => {
    const store = createMemorySessionStore();
    const a = newSession(store).id;
    const b = newSession(store).id;
    store.append(a, {
      type: "user/message",
      ts: 1,
      turnId: "t1",
      content: "hello unique-alpha world",
    });
    store.append(b, {
      type: "assistant/message",
      ts: 2,
      turnId: "t2",
      stepId: "s1",
      content: "reply mentioning unique-beta here",
    });

    const runtime = bareRuntime(store);
    const hitA = await dispatchFaceMethod(runtime, "session.search", "s1", {
      query: "UNIQUE-alpha",
    });
    expect(hitA.result.ok).toBe(true);
    if (hitA.result.ok) {
      const v = hitA.result.value as {
        items: { sessionId: string; snippet: string }[];
        hasMore: boolean;
      };
      expect(v.hasMore).toBe(false);
      expect(v.items).toHaveLength(1);
      expect(v.items[0]!.sessionId).toBe(a);
      expect(v.items[0]!.snippet.toLowerCase()).toContain("unique-alpha");
    }

    const hitB = await dispatchFaceMethod(runtime, "session.search", "s2", {
      query: "unique-beta",
    });
    expect(hitB.result.ok).toBe(true);
    if (hitB.result.ok) {
      const v = hitB.result.value as { items: { sessionId: string }[] };
      expect(v.items.map((i) => i.sessionId)).toEqual([b]);
    }
  });

  it("sets hasMore when more than limit matches", () => {
    const store = createMemorySessionStore();
    for (let i = 0; i < SESSION_SEARCH_RESULT_LIMIT + 3; i++) {
      const id = newSession(store).id;
      store.append(id, {
        type: "user/message",
        ts: i,
        turnId: `t${i}`,
        content: `needle-${i} shared-token`,
      });
    }
    const result = searchSessions(store, "shared-token");
    expect(result.items).toHaveLength(SESSION_SEARCH_RESULT_LIMIT);
    expect(result.hasMore).toBe(true);
  });
});
