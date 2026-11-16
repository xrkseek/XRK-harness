import { describe, expect, it, beforeEach } from "vitest";
import type { LlmAdapter } from "@xrkseek/llm";
import {
  breakSeriesBaseline,
  clearSeriesBaselineAnchors,
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
});
