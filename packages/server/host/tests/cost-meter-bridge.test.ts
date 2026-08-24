import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  configureCostMeterHome,
  costMeterResetHistory,
  loadLedger,
  saveLedger,
} from "../../face/src/cost-meter-store.js";
import { emptyDeepSeekBalance } from "../../face/src/cost-meter-balance.js";
import { fetchTokenLedgerBalanceFromCostMeter } from "../src/cost-meter-bridge.js";

describe("cost-meter tokenledger bridge", () => {
  it("fetchBalance maps cached error without auto-refresh", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "xrk-tkl-bridge-"));
    configureCostMeterHome(home);
    costMeterResetHistory();

    const ledger = loadLedger();
    ledger.balanceCache = {
      ...emptyDeepSeekBalance("err", "API Key missing"),
      fetchedAt: Date.now(),
      currency: "CNY",
    };
    saveLedger(ledger);

    const body = await fetchTokenLedgerBalanceFromCostMeter();
    expect(body.ok).toBe(true);
    expect(body.fetched).toBe(false);
    expect(body.reason).toBe("no-credential");
  });
});
