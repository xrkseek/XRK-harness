import { describe, expect, it } from "vitest";
import {
  EmptyResponseError,
  IncompleteToolCallError,
  LlmError,
} from "@xrkseek/llm";
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

  it("retries a raw stream-socket death, then succeeds", async () => {
    const store = createMemorySessionStore();
    const session = store.create("stream");
    let calls = 0;

    const response = await invokeLlmWithRetry({
      // undici rejects a destroyed response body with a bare TypeError carrying
      // no provider code — the minute-10 `terminated` that used to fail the turn.
      invoke: async () => {
        calls += 1;
        if (calls === 1) throw new TypeError("terminated");
        return { content: "ok" };
      },
      flushChunk: () => {},
      store,
      sessionId: session.id,
      turnId: "t",
      stepId: "s",
      now: () => 1,
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
    const retry = store
      .get(session.id)
      .events.find((e) => e.type === "llm/retry");
    // No provider code to classify, so UNKNOWN — and UNKNOWN retries.
    expect(retry).toMatchObject({ failure: { code: "UNKNOWN" } });
  });

  it("retries a truncated tool call, then succeeds", async () => {
    const store = createMemorySessionStore();
    const session = store.create("truncated-tool");
    let calls = 0;

    const response = await invokeLlmWithRetry({
      invoke: async () => {
        calls += 1;
        if (calls === 1) {
          throw new IncompleteToolCallError("tool arguments truncated");
        }
        return { content: "ok" };
      },
      flushChunk: () => {},
      store,
      sessionId: session.id,
      turnId: "t",
      stepId: "s",
      now: () => 1,
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
    const retry = store
      .get(session.id)
      .events.find((e) => e.type === "llm/retry");
    expect(retry).toMatchObject({
      failure: { code: "INCOMPLETE_TOOL_CALL" },
    });
  });

  it("does not retry QUOTA or a user abort", async () => {
    const store = createMemorySessionStore();
    const quota = store.create("quota");
    await expect(
      invokeLlmWithRetry({
        invoke: async () => {
          throw new LlmError("insufficient_quota", "QUOTA", { status: 400 });
        },
        flushChunk: () => {},
        store,
        sessionId: quota.id,
        turnId: "t",
        stepId: "s",
        now: () => 1,
        policy: resolveRetryPolicy({}),
      }),
    ).rejects.toMatchObject({ code: "QUOTA" });
    expect(store.get(quota.id).events).toHaveLength(0);

    const abort = store.create("abort");
    const ac = new AbortController();
    ac.abort();
    let calls = 0;
    await expect(
      invokeLlmWithRetry({
        invoke: async () => {
          calls += 1;
          throw new DOMException("aborted", "AbortError");
        },
        flushChunk: () => {},
        store,
        sessionId: abort.id,
        turnId: "t",
        stepId: "s",
        now: () => 1,
        signal: ac.signal,
        policy: resolveRetryPolicy({}),
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(calls).toBe(0);
  });

  it("does not retry a TRANSPORT LlmError when the signal is already aborted", async () => {
    // openai-compatible used to wrap AbortSignal.reason `{ kind: "user" }` as
    // TRANSPORT (`openai-compatible: {"kind":"user"}`), which then scheduled
    // llm/retry after Stop. Abort must short-circuit before retry events.
    const store = createMemorySessionStore();
    const session = store.create("stop-wrap");
    const ac = new AbortController();
    await expect(
      invokeLlmWithRetry({
        invoke: async () => {
          ac.abort({ kind: "user" });
          throw new LlmError(
            'openai-compatible: {"kind":"user"}',
            "TRANSPORT",
          );
        },
        flushChunk: () => {},
        store,
        sessionId: session.id,
        turnId: "t",
        stepId: "s",
        now: () => 1,
        signal: ac.signal,
        policy: resolveRetryPolicy({}),
      }),
    ).rejects.toEqual({ kind: "user" });
    expect(store.get(session.id).events).toHaveLength(0);
  });

  it("retries a stream idle timeout, then succeeds", async () => {
    const store = createMemorySessionStore();
    const session = store.create("idle-timeout");
    let calls = 0;

    const response = await invokeLlmWithRetry({
      // What `withStreamIdleTimeout` raises when a provider body goes silent:
      // a hung turn that never used to raise anything at all. TIMEOUT is not
      // in DEFAULT_NON_RETRYABLE_CODES, so the retry loop has to take it —
      // that is the whole point of raising instead of hanging.
      invoke: async () => {
        calls += 1;
        if (calls === 1) {
          throw new LlmError(
            "openai-compatible: idle timeout waiting for stream",
            "TIMEOUT",
          );
        }
        return { content: "ok" };
      },
      flushChunk: () => {},
      store,
      sessionId: session.id,
      turnId: "t",
      stepId: "s",
      now: () => 1,
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
    const retry = store
      .get(session.id)
      .events.find((e) => e.type === "llm/retry");
    expect(retry).toMatchObject({ failure: { code: "TIMEOUT" } });
  });

  it("reuses one retryId across hang attempts in the same step", async () => {
    const store = createMemorySessionStore();
    const session = store.create("retry-chain");
    let calls = 0;

    await invokeLlmWithRetry({
      invoke: async () => {
        calls += 1;
        if (calls < 3) throw new EmptyResponseError();
        return { content: "ok" };
      },
      flushChunk: () => {},
      store,
      sessionId: session.id,
      turnId: "t",
      stepId: "s",
      now: () => 1,
      policy: resolveRetryPolicy({
        initialDelayMs: 0,
        maxDelayMs: 0,
        jitterRatio: 0,
        maxRetries: 5,
      }),
      random: () => 0,
    });

    const retries = store
      .get(session.id)
      .events.filter((e) => e.type === "llm/retry");
    expect(retries).toHaveLength(2);
    expect(retries.map((e) => e.retry)).toEqual([1, 2]);
    expect(retries[0]!.retryId).toBe(retries[1]!.retryId);
  });

  it("resolveRetryPolicy(false) disables", () => {
    expect(resolveRetryPolicy(false)).toBe(false);
  });
});
