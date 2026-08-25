import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  configureCostMeterHome,
  loadLedger,
  migrateAndRepriceLedger,
  saveLedger,
} from "../src/cost-meter-store.js";
import { emptyDay } from "../src/cost-meter-store.js";

describe("migrateAndRepriceLedger", () => {
  it("upgrades V3 tables and reprices flash-scale cache sessions toward ~¥1", () => {
    const home = mkdtempSync(path.join(tmpdir(), "xrk-reprice-"));
    configureCostMeterHome(home);
    const ledger = loadLedger();
    ledger.config.prices = {
      models: {
        "deepseek-chat": { cacheHit: 0.07, cacheMiss: 0.27, output: 1.1 },
      },
      default: { cacheHit: 0.07, cacheMiss: 0.27, output: 1.1 },
    };
    const day = emptyDay("2026-08-25");
    day.sessions.push({
      id: "sess",
      provider: "deepseek",
      model: "DeepSeek V4 Flash Vision Exp",
      input: 158_328,
      output: 76_018,
      cacheRead: 8_971_136,
      cacheWrite: 0,
      reasoning: 0,
      calls: 1,
      cost: 0.77,
      lastAt: Date.now(),
      byModel: {},
      byProviderModel: {},
    });
    day.cost = 0.77;
    ledger.history = [day];
    expect(migrateAndRepriceLedger(ledger)).toBe(true);
    saveLedger(ledger);
    const cny = Number(ledger.history[0]!.sessions[0]!.cost) * 7.2;
    expect(cny).toBeGreaterThan(0.8);
    expect(cny).toBeLessThan(1.5);
  });
});
