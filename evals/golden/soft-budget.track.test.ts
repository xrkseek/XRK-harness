/**
 * Golden track: soft-budget
 * Soft request ceiling (`maxRequestTokens`) → auto compaction → turn recovers.
 * Complements overflow-driven `golden/compact`.
 */
import { describe, expect, it } from "vitest";
import {
  createMemorySessionStore,
  deriveMessages,
} from "@xrkseek/core-session";
import { createToolRegistry } from "@xrkseek/core-tools";
import {
  type LlmAdapter,
  type LlmChatRequest,
  type LlmChatResponse,
} from "@xrkseek/llm";
import { runTurn } from "@xrkseek/core-agent-loop";

describe("golden/soft-budget", () => {
  it("soft budget triggers auto compaction then continues", async () => {
    const store = createMemorySessionStore();
    const session = store.create("eval-soft-budget");
    for (let i = 0; i < 8; i += 1) {
      store.append(session.id, {
        type: "user/message",
        ts: i * 2,
        turnId: `old${i}`,
        content: `msg-${i}-` + "y".repeat(80),
      });
      store.append(session.id, {
        type: "assistant/message",
        ts: i * 2 + 1,
        turnId: `old${i}`,
        stepId: `s${i}`,
        content: `ans-${i}-` + "z".repeat(40),
      });
    }

    const llm: LlmAdapter = {
      id: "eval-soft-budget-llm",
      async chat(req: LlmChatRequest): Promise<LlmChatResponse> {
        const text = req.messages.map((m) => String(m.content)).join("\n");
        const isSummarizer =
          req.messages.length === 1 &&
          req.messages[0]?.role === "user" &&
          text.includes("Create a new anchored summary");
        if (isSummarizer) {
          return { content: "## Objective\n- soft\n## Next\n1. go" };
        }
        return { content: "ok-after-soft-compact" };
      },
    };

    const result = await runTurn({
      sessionId: session.id,
      userText: "continue",
      store,
      llm,
      tools: createToolRegistry(),
      compaction: {
        maxRequestTokens: 50,
        keepTokens: 20,
        bufferTokens: 0,
      },
    });

    expect(result.assistantText).toBe("ok-after-soft-compact");
    const compactEv = store
      .get(session.id)
      .events.find(
        (e) => e.type === "context/compaction" && e.reason === "auto",
      );
    expect(compactEv?.type).toBe("context/compaction");
    const window = deriveMessages(store.get(session.id).events);
    expect(
      window.some(
        (m) => m.role === "assistant" && m.content === "ok-after-soft-compact",
      ),
    ).toBe(true);
  });
});
