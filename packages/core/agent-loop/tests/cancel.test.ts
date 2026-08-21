import { describe, expect, it } from "vitest";
import { createMemorySessionStore } from "@xrkseek/core-session";
import { deriveMessages } from "@xrkseek/core-session";
import type { LlmAdapter, LlmChatRequest, LlmStreamEvent } from "@xrkseek/llm";
import { createToolRegistry } from "@xrkseek/core-tools";
import { runTurn } from "../src/index.js";

function createHangStreamAdapter(partial: string): LlmAdapter {
  return {
    id: "hang",
    async chat() {
      throw new Error("stream-only fixture");
    },
    async *stream(request: LlmChatRequest): AsyncIterable<LlmStreamEvent> {
      if (request.signal?.aborted) {
        throw new DOMException("aborted", "AbortError");
      }
      const head = partial.slice(0, Math.max(1, Math.floor(partial.length / 2)));
      const tail = partial.slice(head.length);
      if (head) yield { type: "text-delta", index: 0, text: head };
      if (tail) yield { type: "text-delta", index: 0, text: tail };
      await new Promise<void>((_resolve, reject) => {
        const onAbort = () => reject(new DOMException("aborted", "AbortError"));
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

    await new Promise((r) => setTimeout(r, 20));
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
});
