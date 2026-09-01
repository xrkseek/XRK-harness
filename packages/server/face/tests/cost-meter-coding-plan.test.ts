import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseAnthropicUsage } from "../src/cost-meter-coding-plans.js";
import {
  configureCostMeterHome,
  costMeterRefreshCodingPlan,
  costMeterResetHistory,
  costMeterUpdateConfig,
} from "../src/cost-meter-store.js";

describe("cost-meter coding plan", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    configureCostMeterHome(undefined);
  });

  it("parseAnthropicUsage normalizes oauth usage windows", () => {
    const windows = parseAnthropicUsage({
      five_hour: { utilization: 12.5, resets_at: 1_700_000_000 },
      seven_day: { utilization: 40, resets_at: "2026-08-23T00:00:00.000Z" },
    });
    expect(windows?.five_hour?.percent).toBe(12.5);
    expect(windows?.seven_day?.percent).toBe(40);
  });

  it("refreshCodingPlan calls provider endpoint and caches windows", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "xrk-cp-"));
    configureCostMeterHome(home);
    costMeterResetHistory();
    costMeterUpdateConfig({
      codingPlans: {
        anthropic: {
          enabled: true,
          display: "both",
          apiKey: "oauth-test-token",
        },
      },
    });

    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        five_hour: { utilization: 20, resets_at: 1_700_000_000 },
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await costMeterRefreshCodingPlan("anthropic");
    expect(result.ok).toBe(true);
    const row = result.state.codingPlans.anthropic as {
      status: string;
      windows: Record<string, { percent: number }>;
    };
    expect(row.status).toBe("ok");
    expect(row.windows.five_hour?.percent).toBe(20);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.anthropic.com/api/oauth/usage",
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: "Bearer oauth-test-token",
        }),
      }),
    );
  });

  it("refreshCodingPlan estimates SCNet from ledger history", async () => {
    // Freeze inside the Aug plan window so Date.now() does not roll the period.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-25T12:00:00"));
    const home = mkdtempSync(path.join(tmpdir(), "xrk-scnet-"));
    configureCostMeterHome(home);
    costMeterResetHistory();
    costMeterUpdateConfig({
      codingPlans: {
        scnet: {
          enabled: true,
          display: "both",
          planCredits: 60000,
          planStart: "2026-08-01",
        },
      },
    });
    const ledger = (
      await import("../src/cost-meter-store.js")
    ).loadLedger();
    ledger.history = [
      {
        date: "2026-08-20",
        input: 1_000_000,
        output: 500_000,
        cacheRead: 0,
        cacheWrite: 0,
        reasoning: 0,
        calls: 1,
        cost: 0.1,
        byModel: {},
        byProviderModel: {
          "deepseek:DeepSeek-V4-Flash": {
            input: 1_000_000,
            output: 500_000,
            cacheRead: 0,
            cacheWrite: 0,
            reasoning: 0,
            cost: 0.1,
          },
        },
        sessions: [],
      },
    ];
    const { saveLedger } = await import("../src/cost-meter-store.js");
    saveLedger(ledger);

    const result = await costMeterRefreshCodingPlan("scnet");
    expect(result.ok).toBe(true);
    const row = result.state.codingPlans.scnet as {
      windows: { monthly?: { percent?: number } };
    };
    expect(row.windows.monthly?.percent).toBeGreaterThan(0);
  });
});
