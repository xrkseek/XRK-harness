import { describe, expect, it, beforeEach } from "vitest";
import { createMemorySessionStore } from "@xrkseek/core-session";
import {
  clearSeriesBaselineAnchors,
  recallSeriesBaseline,
  rememberSeriesBaseline,
} from "@xrkseek/core-agent-loop";
import type { LlmAdapter } from "@xrkseek/llm";
import { resetFaceStateAfterLogCut } from "../src/log-cut-reset.js";
import { createFaceRuntime } from "../src/runtime.js";

const flash: LlmAdapter = {
  id: "ds",
  systemPromptUpdate: "in-history",
  async chat() {
    return { content: "" };
  },
};

beforeEach(() => {
  clearSeriesBaselineAnchors();
});

describe("resetFaceStateAfterLogCut", () => {
  it("drops the in-history series baseline with other process caches", () => {
    const store = createMemorySessionStore();
    const sessionId = store.create().id;
    const runtime = createFaceRuntime({
      store,
      workspaceRoot: process.cwd(),
      drain: {
        wake() {},
        async cancel() {},
        isActive() {
          return false;
        },
      },
      resolveAgent: async () => {
        throw new Error("unused");
      },
    });
    rememberSeriesBaseline(sessionId, flash, "PersonaA");
    runtime.toolDisclosure.expand(sessionId, ["mcp__x"]);
    expect(recallSeriesBaseline(sessionId, flash)).toBe("PersonaA");
    expect(runtime.toolDisclosure.count(sessionId)).toBe(1);

    resetFaceStateAfterLogCut(runtime, sessionId);

    expect(recallSeriesBaseline(sessionId, flash)).toBeUndefined();
    // No request/header in this log → expand stays empty after forget+hydrate.
    expect(runtime.toolDisclosure.count(sessionId)).toBe(0);
  });

  it("re-seeds expand from a remaining request/header after the cut", () => {
    const store = createMemorySessionStore();
    const sessionId = store.create().id;
    store.append(sessionId, {
      type: "request/header",
      ts: 1,
      turnId: "t1",
      reason: "initial",
      header: {
        config: { provider: "deepseek", model: "flash" },
        tools: [
          {
            name: "mcp__kept",
            description: "still on wire",
            parameters: { type: "object" },
          },
        ],
      },
    });
    const runtime = createFaceRuntime({
      store,
      workspaceRoot: process.cwd(),
      drain: {
        wake() {},
        async cancel() {},
        isActive() {
          return false;
        },
      },
      resolveAgent: async () => {
        throw new Error("unused");
      },
    });
    runtime.toolDisclosure.expand(sessionId, ["mcp__ephemeral"]);
    expect(runtime.toolDisclosure.count(sessionId)).toBe(1);

    resetFaceStateAfterLogCut(runtime, sessionId);

    // Memory expand wiped, then hydrated from the surviving header.
    expect(runtime.toolDisclosure.listExpanded(sessionId)).toEqual(
      new Set(["mcp__kept"]),
    );
  });
});
