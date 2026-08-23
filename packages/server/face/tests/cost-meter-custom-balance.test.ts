import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  configureCostMeterHome,
  costMeterGetState,
  costMeterRefreshCustomBalance,
  costMeterResetHistory,
  costMeterUpdateConfig,
} from "../src/cost-meter-store.js";
import { extractByRule } from "../src/cost-meter-custom-balance.js";

describe("cost-meter custom balance", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    configureCostMeterHome(undefined);
  });

  it("extractByRule supports divide for NewApi-style quota", () => {
    const data = { data: { quota: 2_500_000 } };
    const value = extractByRule(data, {
      op: "divide",
      path: "data.quota",
      by: 500_000,
    });
    expect(value).toBe(5);
  });

  it("extractByRule subtracts multiple paths", () => {
    const data = { a: 100, b: 30, c: 10 };
    const value = extractByRule(data, {
      op: "subtract",
      paths: ["a", "b", "c"],
    });
    expect(value).toBe(60);
  });

  it("refreshCustomBalance resolves header templates and persists cache", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "xrk-custom-bal-"));
    configureCostMeterHome(home);
    costMeterResetHistory();
    writeFileSync(
      path.join(home, ".credentials.yaml"),
      "MY_API_KEY: secret-token\n",
      "utf8",
    );
    costMeterUpdateConfig({
      customBalance: {
        enabled: true,
        display: "both",
        label: "NewAPI",
        unit: "USD",
        request: {
          url: "https://provider.example/balance",
          method: "GET",
          headers: { authorization: "Bearer {{MY_API_KEY}}" },
        },
        extract: {
          remaining: { op: "divide", path: "quota", by: 500000 },
          maxBudget: "hard_limit_usd",
        },
      },
    });

    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ quota: 1_500_000, hard_limit_usd: 20 }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await costMeterRefreshCustomBalance();
    expect(result.ok).toBe(true);
    expect(result.state.customBalance.remaining).toBe(3);
    expect(result.state.customBalance.maxBudget).toBe(20);
    expect(result.state.customBalance.label).toBe("NewAPI");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://provider.example/balance",
      expect.objectContaining({
        headers: { authorization: "Bearer secret-token" },
      }),
    );

    const cached = costMeterGetState();
    expect(cached.customBalance.status).toBe("ok");
    expect(cached.customBalance.remaining).toBe(3);
  });
});
