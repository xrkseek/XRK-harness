/**
 * Golden track: compact
 * Overflow once → compaction event (reason=overflow) → turn recovers.
 */
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
import { runTurn } from "@xrkseek/core-agent-loop";

describe("golden/compact", () => {
  it("overflow recovers via context/compaction then continues", async () => {
    const store = createMemorySessionStore();
    const session = store.create("eval-compact");
    let sawOverflow = false;
    const llm: LlmAdapter = {
      id: "eval-compact-llm",
      async chat(req: LlmChatRequest): Promise<LlmChatResponse> {
        const text = req.messages.map((m) => String(m.content)).join("\n");
        const isSummarizer =
          req.messages.length === 1 &&
          req.messages[0]?.role === "user" &&
          text.includes("Create a new anchored summary");
        if (isSummarizer) {
          return { content: "## Objective\n- recovered\n## Next\n1. continue" };
        }
        if (!sawOverflow) {
          sawOverflow = true;
          throw new ContextOverflowError("context too long");
        }
        return { content: "ok-after-compact" };
      },
    };

    for (let i = 0; i < 5; i += 1) {
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
    const compactEv = store
      .get(session.id)
      .events.find(
        (e) => e.type === "context/compaction" && e.reason === "overflow",
      );
    expect(compactEv?.type).toBe("context/compaction");
    const window = deriveMessages(store.get(session.id).events);
    expect(window.some((m) => m.role === "assistant" && m.content === "ok-after-compact")).toBe(
      true,
    );
  });
});
