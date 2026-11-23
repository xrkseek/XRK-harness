import { describe, expect, it, beforeEach } from "vitest";
import type { LlmAdapter } from "@xrkseek/llm";
import type { SessionEvent } from "@xrkseek/protocol";
import {
  breakSeriesBaseline,
  clearSeriesBaselineAnchors,
  hydrateSeriesBaselineFromLog,
  llmRouteKey,
  recallSeriesBaseline,
  rememberSeriesBaseline,
} from "../src/series-baseline.js";

function llm(
  partial: Partial<LlmAdapter> & Pick<LlmAdapter, "id">,
): LlmAdapter {
  return {
    async chat() {
      return { content: "" };
    },
    ...partial,
  };
}

beforeEach(() => {
  clearSeriesBaselineAnchors();
});

describe("series-baseline anchors", () => {
  it("recalls nothing until remembered on an in-history route", () => {
    const flash = llm({ id: "ds", systemPromptUpdate: "in-history" });
    expect(recallSeriesBaseline("s1", flash)).toBeUndefined();
    rememberSeriesBaseline("s1", flash, "PersonaA");
    expect(recallSeriesBaseline("s1", flash)).toBe("PersonaA");
  });

  it("keeps the first baseline when later remember sees a changed prompt", () => {
    const flash = llm({ id: "ds", systemPromptUpdate: "in-history" });
    rememberSeriesBaseline("s1", flash, "PersonaA");
    rememberSeriesBaseline("s1", flash, "PersonaA\n\n## Extra");
    expect(recallSeriesBaseline("s1", flash)).toBe("PersonaA");
  });

  it("ignores remember/recall when the route cannot append", () => {
    const plain = llm({ id: "ds" });
    rememberSeriesBaseline("s1", plain, "PersonaA");
    expect(recallSeriesBaseline("s1", plain)).toBeUndefined();
  });

  it("drops the anchor on route change or explicit break", () => {
    const flash = llm({
      id: "ds",
      systemPromptUpdate: "in-history",
      peekRoute: () => ({ provider: "deepseek", model: "flash" }) as never,
    });
    rememberSeriesBaseline("s1", flash, "PersonaA");
    expect(llmRouteKey(flash)).toContain("flash");
    const other = llm({
      id: "ds",
      systemPromptUpdate: "in-history",
      peekRoute: () => ({ provider: "deepseek", model: "v4-pro" }) as never,
    });
    expect(recallSeriesBaseline("s1", other)).toBeUndefined();
    rememberSeriesBaseline("s1", flash, "PersonaA");
    breakSeriesBaseline("s1");
    expect(recallSeriesBaseline("s1", flash)).toBeUndefined();
  });

  it("hydrates the first post-compaction request/header system after restart", () => {
    const flash = llm({ id: "ds", systemPromptUpdate: "in-history" });
    const events: SessionEvent[] = [
      {
        type: "request/header",
        ts: 1,
        turnId: "t0",
        reason: "initial",
        header: { system: "PersonaA", config: { provider: "ds", model: "flash" } },
      },
      {
        type: "context/compaction",
        ts: 2,
        reason: "auto",
        summary: "old",
        recent: "",
      },
      {
        type: "request/header",
        ts: 3,
        turnId: "t1",
        reason: "change",
        header: {
          system: "PersonaB",
          config: { provider: "ds", model: "flash" },
        },
      },
    ];
    expect(hydrateSeriesBaselineFromLog("s1", flash, events)).toBe("PersonaB");
    expect(recallSeriesBaseline("s1", flash)).toBe("PersonaB");
    // Second hydrate is a no-op when the in-memory anchor already matches.
    expect(hydrateSeriesBaselineFromLog("s1", flash, events)).toBe("PersonaB");
  });
});
