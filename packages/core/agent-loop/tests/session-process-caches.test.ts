import { describe, expect, it, beforeEach } from "vitest";
import {
  clearSeriesBaselineAnchors,
  recallSeriesBaseline,
  rememberSeriesBaseline,
} from "../src/series-baseline.js";
import { forgetSessionProcessCaches } from "../src/session-process-caches.js";
import {
  clearTimeContextRefreshState,
  shouldRefreshTimeContext,
} from "@xrkseek/core-system-prompt";
import type { LlmAdapter } from "@xrkseek/llm";

const flash: LlmAdapter = {
  id: "ds",
  systemPromptUpdate: "in-history",
  async chat() {
    return { content: "" };
  },
};

beforeEach(() => {
  clearSeriesBaselineAnchors();
  clearTimeContextRefreshState();
});

describe("forgetSessionProcessCaches", () => {
  it("drops series baseline and time-context stamp for one session", () => {
    rememberSeriesBaseline("s1", flash, "PersonaA");
    rememberSeriesBaseline("s2", flash, "PersonaB");
    expect(shouldRefreshTimeContext("s1", 1000, 60_000)).toBe(true);
    expect(shouldRefreshTimeContext("s1", 2000, 60_000)).toBe(false);

    forgetSessionProcessCaches("s1");

    expect(recallSeriesBaseline("s1", flash)).toBeUndefined();
    expect(recallSeriesBaseline("s2", flash)).toBe("PersonaB");
    expect(shouldRefreshTimeContext("s1", 3000, 60_000)).toBe(true);
  });
});
