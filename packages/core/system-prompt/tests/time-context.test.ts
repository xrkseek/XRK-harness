import { describe, expect, it } from "vitest";
import {
  clearTimeContextRefreshState,
  parseTimeContextRefreshMs,
  shouldRefreshTimeContext,
} from "../src/time-context.js";

describe("time-context refresh", () => {
  it("parses env: unset=60s, 0=every, off=disabled", () => {
    expect(parseTimeContextRefreshMs(undefined)).toBe(60_000);
    expect(parseTimeContextRefreshMs("0")).toBe(0);
    expect(parseTimeContextRefreshMs("off")).toBe(-1);
    expect(parseTimeContextRefreshMs("120000")).toBe(120_000);
  });

  it("gates follow-up injections by interval", () => {
    clearTimeContextRefreshState();
    expect(shouldRefreshTimeContext("s1", 1000, 60_000)).toBe(true);
    expect(shouldRefreshTimeContext("s1", 30_000, 60_000)).toBe(false);
    expect(shouldRefreshTimeContext("s1", 61_000, 60_000)).toBe(true);
    expect(shouldRefreshTimeContext("s2", 61_000, 60_000)).toBe(true);
    clearTimeContextRefreshState();
  });
});
