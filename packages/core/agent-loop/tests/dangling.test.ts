import { describe, expect, it } from "vitest";
import {
  TOOL_OUTCOME_UNKNOWN_MESSAGE,
  createMemorySessionStore,
  deriveMessages,
  listDanglingToolCalls,
} from "@xrkseek/core-session";
import { createToolRegistry } from "@xrkseek/core-tools";
import { createReplayAdapter } from "@xrkseek/llm-replay";
import { runTurn } from "../src/index.js";

describe("runTurn fail-before-retry", () => {
  it("settles dangling tools before the new turn", async () => {
    const store = createMemorySessionStore();
    const session = store.create();
    store.append(session.id, {
      type: "assistant/message",
      ts: 1,
      turnId: "old",
      stepId: "old_s",
      content: "",
      toolCalls: [{ id: "orphan", name: "echo", arguments: { text: "x" } }],
    });
    store.append(session.id, {
      type: "tool/call",
      ts: 2,
      turnId: "old",
      stepId: "old_s",
      call: { id: "orphan", name: "echo", arguments: { text: "x" } },
    });
    expect(listDanglingToolCalls(store.get(session.id).events)).toHaveLength(1);

    const result = await runTurn({
      sessionId: session.id,
      userText: "continue",
      store,
      llm: createReplayAdapter([{ content: "ok" }]),
      tools: createToolRegistry(),
      now: (() => {
        let t = 10;
        return () => {
          t += 1;
          return t;
        };
      })(),
    });

    expect(result.assistantText).toBe("ok");
    expect(result.toolFailed).toBe(1);
    expect(listDanglingToolCalls(store.get(session.id).events)).toHaveLength(0);

    const msgs = deriveMessages(store.get(session.id).events);
    const interrupted = msgs.find(
      (m) => m.role === "tool" && m.toolCallId === "orphan",
    );
    expect(interrupted).toMatchObject({
      content: TOOL_OUTCOME_UNKNOWN_MESSAGE,
      isError: true,
    });
    // New user turn still reconstructible after settlement prefix.
    expect(msgs.some((m) => m.role === "user" && m.content === "continue")).toBe(
      true,
    );
  });
});
