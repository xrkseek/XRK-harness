import { describe, expect, it } from "vitest";
import { EmptyResponseError, LlmError } from "@xrkseek/llm";
import { createMemorySessionStore } from "@xrkseek/core-session";
import {
  invokeLlmWithRetry,
  resolveRetryPolicy,
} from "../src/llm-retry.js";

describe("invokeLlmWithRetry", () => {
  it("retries EMPTY_RESPONSE then succeeds; live-flushes every attempt", async () => {
    const store = createMemorySessionStore();
    const session = store.create("retry");
    let calls = 0;
    const flushed: string[] = [];

    const response = await invokeLlmWithRetry({
      invoke: async (onChunk) => {
        calls += 1;
        onChunk({ kind: "text", index: 0, text: `attempt-${calls}` });
        if (calls === 1) throw new EmptyResponseError();
        return { content: "ok" };
      },
      flushChunk: (c) => {
        if (c.kind === "text") flushed.push(c.text);
      },
      store,
      sessionId: session.id,
      turnId: "t1",
      stepId: "s1",
      now: () => 100 + calls,
      policy: resolveRetryPolicy({
        initialDelayMs: 0,
        maxDelayMs: 0,
        jitterRatio: 0,
        maxRetries: 2,
      }),
      random: () => 0,
    });

    expect(response.content).toBe("ok");
    expect(calls).toBe(2);
    // Live flush paints attempt-1; llm/retry clears the client surface.
    expect(flushed).toEqual(["attempt-1", "attempt-2"]);
    const types = store.get(session.id).events.map((e) => e.type);
    expect(types).toEqual(["llm/retry", "llm/retry-started"]);
  });

  it("does not retry AUTH", async () => {
    const store = createMemorySessionStore();
    const session = store.create("auth");
    await expect(
      invokeLlmWithRetry({
        invoke: async () => {
          throw new LlmError("nope", "AUTH", { status: 401 });
        },
        flushChunk: () => {},
        store,
        sessionId: session.id,
        turnId: "t",
        stepId: "s",
        now: () => 1,
        policy: resolveRetryPolicy({}),
      }),
    ).rejects.toMatchObject({ code: "AUTH" });
    expect(store.get(session.id).events).toHaveLength(0);
  });

  it("aborts during backoff", async () => {
    const store = createMemorySessionStore();
    const session = store.create("abort");
    const ac = new AbortController();
    const p = invokeLlmWithRetry({
      invoke: async () => {
        throw new EmptyResponseError();
      },
      flushChunk: () => {},
      store,
      sessionId: session.id,
      turnId: "t",
      stepId: "s",
      now: () => 1,
      signal: ac.signal,
      policy: resolveRetryPolicy({
        initialDelayMs: 60_000,
        maxDelayMs: 60_000,
        jitterRatio: 0,
      }),
    });
    queueMicrotask(() => ac.abort());
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
  });

  it("resolveRetryPolicy(false) disables", () => {
    expect(resolveRetryPolicy(false)).toBe(false);
  });
});
