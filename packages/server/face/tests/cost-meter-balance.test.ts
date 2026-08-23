import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deepSeekBalanceEndpoint,
  pickBalanceInfo,
  queryDeepSeekBalance,
} from "../src/cost-meter-balance.js";
import {
  configureCostMeterHome,
  costMeterGetState,
  costMeterRefreshBalance,
  costMeterResetHistory,
} from "../src/cost-meter-store.js";

describe("cost-meter balance", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    configureCostMeterHome(undefined);
  });

  it("pickBalanceInfo prefers CNY when multiple currencies have balance", () => {
    const picked = pickBalanceInfo([
      { currency: "USD", total_balance: 10 },
      { currency: "CNY", total_balance: 50 },
    ]);
    expect(picked?.currency).toBe("CNY");
  });

  it("deepSeekBalanceEndpoint rejects non-official hosts", () => {
    expect(deepSeekBalanceEndpoint("https://evil.example.com")).toBeNull();
    expect(deepSeekBalanceEndpoint("https://api.deepseek.com/v1")).toBe(
      "https://api.deepseek.com/user/balance",
    );
  });

  it("refreshBalance calls official API and persists cache", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "xrk-bal-"));
    configureCostMeterHome(home);
    costMeterResetHistory();
    writeFileSync(
      path.join(home, "settings.yaml"),
      "llm-deepseek:\n  apiKeyEnv: DEEPSEEK_API_KEY\n",
      "utf8",
    );
    writeFileSync(
      path.join(home, ".credentials.yaml"),
      "DEEPSEEK_API_KEY: sk-test-balance\n",
      "utf8",
    );

    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        balance_infos: [
          {
            currency: "CNY",
            total_balance: "12.34",
            granted_balance: "1.00",
            topped_up_balance: "11.34",
          },
        ],
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await costMeterRefreshBalance();
    expect(result.ok).toBe(true);
    expect(result.state.balance.totalBalance).toBe(12.34);
    expect(result.state.balance.status).toBe("ok");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.deepseek.com/user/balance",
      expect.objectContaining({
        headers: { authorization: "Bearer sk-test-balance" },
      }),
    );

    const cached = costMeterGetState();
    expect(cached.balance.totalBalance).toBe(12.34);
    expect(cached.balance.fetchedAt).toBeGreaterThan(0);
  });

  it("queryDeepSeekBalance reports missing API key", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "xrk-bal-miss-"));
    const snapshot = await queryDeepSeekBalance(home);
    expect(snapshot.status).toBe("err");
    expect(snapshot.message).toContain("DEEPSEEK_API_KEY");
  });
});
