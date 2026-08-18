import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createJsonlSessionStore,
  createMemorySessionStore,
  newSession,
} from "@xrkseek/core-session";
import { createProviderRegistry } from "@xrkseek/llm-registry";
import { dispatchFaceMethod } from "../src/dispatch.js";
import {
  SESSION_SEARCH_RESULT_LIMIT,
  searchSessions,
} from "../src/session-search.js";
import { createBareFaceRuntime } from "./helpers/bare-runtime.js";

function bareRuntime(store = createMemorySessionStore()) {
  return createBareFaceRuntime({
    store,
    registry: createProviderRegistry(),
  });
}

describe("session.search", () => {
  it("rejects empty / NUL / missing query", async () => {
    const runtime = bareRuntime();
    for (const payload of [{}, { query: "" }, { query: "   " }, { query: "a\0b" }]) {
      const res = await dispatchFaceMethod(runtime, "session.search", "q1", payload);
      expect(res.result.ok).toBe(false);
      if (!res.result.ok) {
        expect(res.result.error.code).toBe("bad-request");
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

  it("ranks newest activity first and hits pending admits", async () => {
    const store = createMemorySessionStore();
    const oldId = newSession(store).id;
    const newId = newSession(store).id;
    store.append(oldId, {
      type: "user/message",
      ts: 1,
      turnId: "t-old",
      content: "shared-rank old",
    });
    store.append(newId, {
      type: "user/message",
      ts: 9,
      turnId: "t-new",
      content: "shared-rank new",
    });
    const result = searchSessions(store, "shared-rank");
    expect(result.items.map((i) => i.sessionId)).toEqual([newId, oldId]);

    const pending = newSession(store).id;
    store.append(pending, {
      type: "prompt/admitted",
      ts: 10,
      admitId: "a1",
      content: "queued unique-admit-token",
    });
    const admitHit = searchSessions(store, "unique-admit-token");
    expect(admitHit.items.map((i) => i.sessionId)).toEqual([pending]);

    const notice = newSession(store).id;
    store.append(notice, {
      type: "safety/notice",
      ts: 11,
      turnId: "t-safe",
      kind: "loop_hard",
      content: "unique-safety-token fired",
    });
    const safetyHit = searchSessions(store, "unique-safety-token");
    expect(safetyHit.items.map((i) => i.sessionId)).toEqual([notice]);
  });

  it("hits command text and standing todos", () => {
    const store = createMemorySessionStore();
    const cmd = newSession(store).id;
    store.append(cmd, {
      type: "command/run",
      ts: 1,
      commandId: "cmd_1",
      name: "goal",
      args: "unique-command-token",
      source: { kind: "user" },
    });
    store.append(cmd, {
      type: "command/done",
      ts: 2,
      commandId: "cmd_1",
      kind: "success",
      text: "goal g1",
    });
    expect(searchSessions(store, "unique-command-token").items.map((i) => i.sessionId)).toEqual(
      [cmd],
    );

    const todos = newSession(store).id;
    store.append(todos, {
      type: "todo/write",
      ts: 3,
      todos: [{ content: "unique-todo-token migrate auth", status: "pending" }],
    });
    expect(searchSessions(store, "unique-todo-token").items.map((i) => i.sessionId)).toEqual(
      [todos],
    );

    const feedback = newSession(store).id;
    store.append(feedback, {
      type: "feedback/record",
      ts: 4,
      text: "unique-feedback-token the diff view is unreadable",
    });
    expect(
      searchSessions(store, "unique-feedback-token").items.map((i) => i.sessionId),
    ).toEqual([feedback]);
  });

  it("scans JSONL-backed sessions the same way", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "xrk-search-"));
    const store = createJsonlSessionStore(dir);
    const id = newSession(store).id;
    store.append(id, {
      type: "user/message",
      ts: 1,
      turnId: "t1",
      content: "unique-jsonl-token on disk",
    });
    const reloaded = createJsonlSessionStore(dir);
    const hit = searchSessions(reloaded, "unique-jsonl-token");
    expect(hit.items.map((i) => i.sessionId)).toEqual([id]);
  });
});
