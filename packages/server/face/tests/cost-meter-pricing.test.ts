import { describe, expect, it } from "vitest";
import {
  bundledCostMeterPriceConfig,
  canonModelId,
  estimateUsageCostUsd,
} from "../src/cost-meter-pricing.js";

describe("cost-meter pricing (DSH-aligned)", () => {
  const config = bundledCostMeterPriceConfig();

  it("prices disjoint input + cacheRead like dsh-cost-meter costOf", () => {
    // input already uncached; must NOT subtract cacheRead again.
    const usd = estimateUsageCostUsd(
      {
        provider: "deepseek",
        model: "deepseek-v4-flash",
        input: 100,
        output: 50,
        cacheRead: 900,
        cacheWrite: 0,
        reasoning: 0,
      },
      config,
    );
    // flash off-peak: miss 0.22, hit 0.007, out 0.66
    const expected = (100 * 0.22 + 50 * 0.66 + 900 * 0.007) / 1_000_000;
    expect(usd).toBeCloseTo(expected, 12);
  });

  it("matches live flash session ballpark (~¥1 not ¥5)", () => {
    const usd = estimateUsageCostUsd(
      {
        provider: "deepseek",
        model: "DeepSeek V4 Flash Vision Exp",
        input: 158_328,
        output: 76_018,
        cacheRead: 8_971_136,
        cacheWrite: 0,
        reasoning: 0,
      },
      config,
    );
    const cny = usd * 7.2;
    expect(cny).toBeGreaterThan(0.8);
    expect(cny).toBeLessThan(1.5);
  });

  it("does not double-bill reasoning by default", () => {
    const withReason = estimateUsageCostUsd(
      {
        provider: "deepseek",
        model: "deepseek-v4-flash",
        input: 0,
        output: 1000,
        cacheRead: 0,
        cacheWrite: 0,
        reasoning: 1000,
      },
      config,
    );
    const outputOnly = estimateUsageCostUsd(
      {
        provider: "deepseek",
        model: "deepseek-v4-flash",
        input: 0,
        output: 1000,
        cacheRead: 0,
        cacheWrite: 0,
        reasoning: 0,
      },
      config,
    );
    expect(withReason).toBeCloseTo(outputOnly, 12);
  });

  it("canonModelId strips punctuation for matching", () => {
    expect(canonModelId("DeepSeek V4 Flash Vision Exp")).toBe(
      "deepseekv4flashvisionexp",
    );
  });
});
