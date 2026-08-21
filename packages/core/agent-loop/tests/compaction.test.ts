import { describe, expect, it } from "vitest";
import {
  createMemorySessionStore,
  deriveMessages,
} from "@xrkseek/core-session";
import { createToolRegistry } from "@xrkseek/core-tools";
import {
  ContextOverflowError,
  type LlmAdapter,
  type LlmChatRequest,
  type LlmChatResponse,
} from "@xrkseek/llm";
import { runTurn } from "../src/index.js";

describe("runTurn compaction / overflow", () => {
  it("recovers once from ContextOverflowError", async () => {
    const store = createMemorySessionStore();
    const session = store.create();
    let chats = 0;
    let sawOverflow = false;
    const llm: LlmAdapter = {
      id: "overflow-once",
      async chat(req: LlmChatRequest): Promise<LlmChatResponse> {
        chats += 1;
        const text = req.messages.map((m) => m.content).join("\n");
        // Summarizer-only call: single user message that is the compaction prompt.
        const isSummarizer =
          req.messages.length === 1 &&
          req.messages[0]?.role === "user" &&
          text.includes("Create a new anchored summary");
        if (isSummarizer) {
          return { content: "## Objective\n- recovered\n## Next\n1. continue" };
        }
        if (!sawOverflow) {
          sawOverflow = true;
          throw new ContextOverflowError("too long");
        }
        return { content: "ok-after-compact" };
      },
    };

    // Seed long history
    for (let i = 0; i < 5; i++) {
      store.append(session.id, {
        type: "user/message",
        ts: i * 2,
        turnId: `old${i}`,
        content: `msg-${i}-` + "x".repeat(50),
      });
      store.append(session.id, {
        type: "assistant/message",
        ts: i * 2 + 1,
        turnId: `old${i}`,
        stepId: `s${i}`,
        content: `ans-${i}`,
      });
    }

    const result = await runTurn({
      sessionId: session.id,
      userText: "continue",
      store,
      llm,
      tools: createToolRegistry(),
      compaction: { keepTokens: 40 },
    });

    expect(result.assistantText).toBe("ok-after-compact");
    expect(
      store
        .get(session.id)
        .events.some(
          (e) => e.type === "context/compaction" && e.reason === "overflow",
        ),
    ).toBe(true);
    const msgs = deriveMessages(store.get(session.id).events);
    expect(msgs.some((m) => String(m.content).includes("recovered"))).toBe(
      true,
    );
  });

  it("does not retry overflow twice", async () => {
    const store = createMemorySessionStore();
    const session = store.create();
    const llm: LlmAdapter = {
      id: "always-overflow",
      async chat(req) {
        const text = req.messages.map((m) => m.content).join("\n");
        const isSummarizer =
          req.messages.length === 1 &&
          req.messages[0]?.role === "user" &&
          (text.includes("Create a new anchored summary") ||
            text.includes("Update the anchored summary"));
        if (isSummarizer) {
          return { content: "## Objective\n- x" };
        }
        throw new ContextOverflowError("still too long");
      },
    };
    store.append(session.id, {
      type: "user/message",
      ts: 1,
      turnId: "t",
      content: "old",
    });

    await expect(
      runTurn({
        sessionId: session.id,
        userText: "go",
        store,
        llm,
        tools: createToolRegistry(),
        compaction: {},
      }),
    ).rejects.toBeInstanceOf(ContextOverflowError);
  });

  it("prunes oversized tool results before overflow compact", async () => {
    const store = createMemorySessionStore();
    const session = store.create();
    const big = "Z".repeat(9000);
    store.append(session.id, {
      type: "user/message",
      ts: 1,
      turnId: "old",
      content: "seed",
    });
    store.append(session.id, {
      type: "assistant/message",
      ts: 2,
      turnId: "old",
      stepId: "s0",
      content: "",
      toolCalls: [{ id: "c1", name: "read", arguments: {} }],
    });
    store.append(session.id, {
      type: "tool/result",
      ts: 3,
      turnId: "old",
      stepId: "s0",
      result: { toolCallId: "c1", name: "read", content: big },
    });

    let sawOverflow = false;
    let chatsAfterOverflow = 0;
    const llm: LlmAdapter = {
      id: "overflow-prune",
      async chat(req: LlmChatRequest): Promise<LlmChatResponse> {
        const text = req.messages.map((m) => m.content).join("\n");
        const isSummarizer =
          req.messages.length === 1 &&
          req.messages[0]?.role === "user" &&
          text.includes("Create a new anchored summary");
        if (isSummarizer) {
          return { content: "## Objective\n- pruned\n## Next\n1. continue" };
        }
        if (!sawOverflow) {
          sawOverflow = true;
          throw new ContextOverflowError("too long");
        }
        chatsAfterOverflow += 1;
        return { content: "ok" };
      },
    };

    const result = await runTurn({
      sessionId: session.id,
      userText: "continue",
      store,
      llm,
      tools: createToolRegistry(),
      compaction: { keepTokens: 40 },
    });
    expect(result.assistantText).toBe("ok");
    // Prune alone can clear overflow — summarizer may be skipped.
    expect(chatsAfterOverflow).toBeGreaterThanOrEqual(1);
    const toolResults = store
      .get(session.id)
      .events.filter((e) => e.type === "tool/result");
    expect(toolResults.length).toBeGreaterThanOrEqual(2);
    const latest = toolResults[toolResults.length - 1]!;
    expect(String(latest.result.content).length).toBeLessThan(big.length);
    expect(String(latest.result.content)).toContain("chars omitted");
  });
});
