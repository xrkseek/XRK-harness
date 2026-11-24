import { describe, expect, it } from "vitest";
import { createMemorySessionStore } from "@xrkseek/core-session";
import { deriveMessages } from "@xrkseek/core-session";
import type { LlmAdapter, LlmChatRequest, LlmStreamEvent } from "@xrkseek/llm";
import { createToolRegistry } from "@xrkseek/core-tools";
import { runTurn } from "../src/index.js";
import {
  formatAbortReason,
  isAbortError,
  isAgentCancelCause,
} from "../src/cancel-finalize.js";

function createHangStreamAdapter(partial: string): LlmAdapter {
  return {
    id: "hang",
    async chat() {
      throw new Error("stream-only fixture");
    },
    async *stream(request: LlmChatRequest): AsyncIterable<LlmStreamEvent> {
      if (request.signal?.aborted) {
        // Mirror Node throwIfAborted: rethrow the plain cancel cause when set.
        throw request.signal.reason ?? new DOMException("aborted", "AbortError");
      }
      // One delta so live-flush sees the full prefix before we hang (multi-
      // delta flush is not guaranteed mid-step before abort).
      if (partial) yield { type: "text-delta", index: 0, text: partial };
      await new Promise<void>((_resolve, reject) => {
        const onAbort = () => {
          reject(
            request.signal?.reason ?? new DOMException("aborted", "AbortError"),
          );
        };
        if (request.signal?.aborted) {
          onAbort();
          return;
        }
        request.signal?.addEventListener("abort", onAbort, { once: true });
      });
    },
  };
}

describe("cancel mid-stream prefix finalize (DSH rc.8)", () => {
  it("commits streamed prefix as interrupted assistant/message and closes turn", async () => {
    const store = createMemorySessionStore();
    const session = store.create();
    const ac = new AbortController();
    const llm = createHangStreamAdapter("partial reply");

    const turnP = runTurn({
      sessionId: session.id,
      userText: "go",
      store,
      llm,
      tools: createToolRegistry(),
      signal: ac.signal,
    });

    // Wait until the live-flushed prefix is durable before abort.
    const deadline = Date.now() + 2_000;
    for (;;) {
      const chunks = store
        .get(session.id)
        .events.filter((e) => e.type === "assistant/chunk");
      const text = chunks
        .map((e) => (e.type === "assistant/chunk" ? e.text : ""))
        .join("");
      if (text === "partial reply" || Date.now() >= deadline) break;
      await new Promise((r) => setTimeout(r, 5));
    }
    ac.abort();
    await expect(turnP).rejects.toMatchObject({ name: "AbortError" });

    const events = store.get(session.id).events;
    const message = events.find((e) => e.type === "assistant/message");
    expect(message?.type).toBe("assistant/message");
    if (message?.type === "assistant/message") {
      expect(message.content).toBe("partial reply");
      expect(message.interrupted).toBe(true);
    }

    const types = events.map((e) => e.type);
    expect(types.indexOf("assistant/message")).toBeLessThan(types.indexOf("step/end"));
    expect(types.indexOf("step/end")).toBeLessThan(types.indexOf("turn/end"));

    const turnEnd = events.find((e) => e.type === "turn/end");
    expect(turnEnd?.type === "turn/end" && turnEnd.reason).toEqual({
      kind: "aborted",
      reason: { kind: "legacy" },
    });

    const assistantMsgs = deriveMessages(events).filter(
      (m) => m.role === "assistant",
    );
    expect(assistantMsgs).toEqual([
      { role: "assistant", content: "partial reply" },
    ]);
  });

  it("unexpected throw closes as turn/end error UNKNOWN, not aborted/legacy", async () => {
    const store = createMemorySessionStore();
    const session = store.create();

    await expect(
      runTurn({
        sessionId: session.id,
        userText: "go",
        store,
        llm: {
          id: "boom",
          async chat() {
            throw new TypeError("unexpected pipeline boom");
          },
        },
        tools: createToolRegistry(),
        llmRetry: false,
      }),
    ).rejects.toBeInstanceOf(TypeError);

    const turnEnd = store.get(session.id).events.find((e) => e.type === "turn/end");
    expect(turnEnd?.type).toBe("turn/end");
    if (turnEnd?.type === "turn/end") {
      expect(turnEnd.reason).toMatchObject({
        kind: "error",
        error: { code: "UNKNOWN", message: "unexpected pipeline boom" },
      });
    }
  });

  it("user cancel cause ends as aborted, never turn/end error [object Object]", async () => {
    const store = createMemorySessionStore();
    const session = store.create();
    const ac = new AbortController();
    const llm = createHangStreamAdapter("partial reply");

    const turnP = runTurn({
      sessionId: session.id,
      userText: "go",
      store,
      llm,
      tools: createToolRegistry(),
      signal: ac.signal,
    });

    await new Promise((r) => setTimeout(r, 20));
    ac.abort({ kind: "user" });
    await expect(turnP).rejects.toEqual({ kind: "user" });

    const turnEnd = store.get(session.id).events.find((e) => e.type === "turn/end");
    expect(turnEnd?.type === "turn/end" && turnEnd.reason).toEqual({
      kind: "aborted",
      reason: { kind: "user" },
    });
    // Must not look like a terminal failure chrome row.
    expect(
      turnEnd?.type === "turn/end" && turnEnd.reason.kind === "error",
    ).toBe(false);
  });
});

describe("isAbortError / formatAbortReason", () => {
  it("recognizes plain cancel causes and AbortError Errors", () => {
    const ac = new AbortController();
    ac.abort({ kind: "user" });
    expect(isAgentCancelCause({ kind: "user" })).toBe(true);
    expect(isAbortError({ kind: "user" }, ac.signal)).toBe(true);
    expect(isAbortError(ac.signal.reason, ac.signal)).toBe(true);
    const named = new Error("[object Object]");
    named.name = "AbortError";
    expect(isAbortError(named, ac.signal)).toBe(true);
    expect(formatAbortReason({ kind: "user" })).toBe("aborted by user");
    expect(formatAbortReason({ kind: "user" })).not.toBe("[object Object]");
  });

  it("treats AbortError / ABORTED even when signal is not yet aborted", () => {
    const live = new AbortController();
    const named = new DOMException("aborted", "AbortError");
    expect(live.signal.aborted).toBe(false);
    expect(isAbortError(named, live.signal)).toBe(true);
    const coded = new Error("openai-compatible: aborted");
    (coded as { code?: string }).code = "ABORTED";
    expect(isAbortError(coded, live.signal)).toBe(true);
  });
});

describe("AbortError without signal.aborted closes as aborted", () => {
  it("does not paint turn/end error UNKNOWN for stream AbortError", async () => {
    const store = createMemorySessionStore();
    const session = store.create();
    const ac = new AbortController();

    await expect(
      runTurn({
        sessionId: session.id,
        userText: "go",
        store,
        llm: {
          id: "abort-race",
          async chat() {
            throw new DOMException("aborted", "AbortError");
          },
        },
        tools: createToolRegistry(),
        signal: ac.signal,
        llmRetry: false,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });

    const turnEnd = store.get(session.id).events.find((e) => e.type === "turn/end");
    expect(turnEnd?.type === "turn/end" && turnEnd.reason).toMatchObject({
      kind: "aborted",
    });
    expect(
      turnEnd?.type === "turn/end" && turnEnd.reason.kind === "error",
    ).toBe(false);
  });
});
