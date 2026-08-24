import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createMemorySessionStore } from "@xrkseek/core-session";
import {
  configureCostMeterHome,
  costMeterAggregateUsage,
  costMeterGetState,
  costMeterResetHistory,
  loadLedger,
  saveLedger,
} from "../src/cost-meter-store.js";
import { emptyDeepSeekBalance } from "../src/cost-meter-balance.js";
import { costMeterImportLegacyHistoryFromStore } from "../src/cost-meter-record.js";
import { dispatchFaceMethod } from "../src/dispatch.js";
import { createBareFaceRuntime } from "./helpers/bare-runtime.js";

describe("cost-meter ledger", () => {
  it("records assistant/message usage on session append", () => {
    const home = mkdtempSync(path.join(tmpdir(), "xrk-cost-meter-"));
    configureCostMeterHome(home);
    costMeterResetHistory();

    const store = createMemorySessionStore();
    const runtime = createBareFaceRuntime({ store, productDir: home });
    const session = store.create("sess-cost");
    const ts = Date.now();

    store.append(session.id, {
      type: "request/header",
      ts,
      turnId: "turn-1",
      reason: "initial",
      header: {
        config: { provider: "deepseek", model: "deepseek-chat" },
      },
    });
    store.append(session.id, {
      type: "assistant/message",
      ts,
      turnId: "turn-1",
      stepId: "step-1",
      content: "hello",
      usage: {
        inputTokens: 120,
        outputTokens: 40,
        cacheReadTokens: 10,
      },
    });

    const state = costMeterGetState();
    expect(state.today.calls).toBe(1);
    expect(state.today.input).toBe(120);
    expect(state.today.output).toBe(40);
    expect(state.today.cacheRead).toBe(10);
    expect(state.today.cost).toBeGreaterThan(0);
    expect(state.today.sessions[0]?.id).toBe("sess-cost");
    void runtime;
  });

  it("importLegacyHistory replays session log idempotently", () => {
    const home = mkdtempSync(path.join(tmpdir(), "xrk-cost-import-"));
    configureCostMeterHome(home);
    costMeterResetHistory();

    const store = createMemorySessionStore();
    const runtime = createBareFaceRuntime({ store, productDir: home });
    const session = store.create("sess-import");
    const ts = Date.now();

    store.append(session.id, {
      type: "request/header",
      ts,
      turnId: "turn-2",
      reason: "initial",
      header: {
        config: { provider: "deepseek", model: "deepseek-chat" },
      },
    });
    store.append(session.id, {
      type: "assistant/message",
      ts,
      turnId: "turn-2",
      stepId: "step-2",
      content: "world",
      usage: { inputTokens: 50, outputTokens: 20 },
    });

    costMeterResetHistory();
    const first = costMeterImportLegacyHistoryFromStore(
      store,
      runtime.sessionModels,
    );
    expect(first.imported).toBe(1);
    expect(first.state.today.calls).toBe(1);

    const second = costMeterImportLegacyHistoryFromStore(
      store,
      runtime.sessionModels,
    );
    expect(second.imported).toBe(0);
    expect(second.skipped).toBe(1);
    expect(second.state.today.calls).toBe(1);
  });

  it("costMeter/importLegacyHistory Face remote returns flat import result", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "xrk-cost-remote-"));
    configureCostMeterHome(home);
    costMeterResetHistory();

    const store = createMemorySessionStore();
    const session = store.create("sess-remote");
    store.append(session.id, {
      type: "request/header",
      ts: Date.now(),
      turnId: "t",
      reason: "initial",
      header: {
        config: { provider: "deepseek", model: "deepseek-chat" },
      },
    });
    store.append(session.id, {
      type: "assistant/message",
      ts: Date.now(),
      turnId: "t",
      stepId: "s",
      content: "x",
      usage: { inputTokens: 3, outputTokens: 1 },
    });

    const runtime = createBareFaceRuntime({ store, productDir: home });

    const res = await dispatchFaceMethod(
      runtime,
      "costMeter/importLegacyHistory",
      "cm-import",
      { args: {} },
    );
    expect(res.result.ok).toBe(true);
    if (!res.result.ok) throw new Error("import");
    const body = res.result.value as { imported: number };
    expect(body.imported).toBe(1);
  });

  it("aggregateUsage exposes tokenledger totals and DSH balance status", () => {
    const home = mkdtempSync(path.join(tmpdir(), "xrk-cost-meter-agg-"));
    configureCostMeterHome(home);
    costMeterResetHistory();

    const store = createMemorySessionStore();
    const runtime = createBareFaceRuntime({ store, productDir: home });
    const session = store.create("sess-agg");
    const ts = Date.now();

    store.append(session.id, {
      type: "request/header",
      ts,
      turnId: "turn-agg",
      reason: "initial",
      header: {
        config: { provider: "deepseek", model: "deepseek-chat" },
      },
    });
    store.append(session.id, {
      type: "assistant/message",
      ts,
      turnId: "turn-agg",
      stepId: "step-agg",
      content: "hello",
      usage: {
        inputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 5,
      },
    });

    const agg = costMeterAggregateUsage() as {
      totals: { tokens: number; requests: number };
      windows: { today: { tokens: number } };
      sites: Array<{ site: string; tokens: number }>;
    };
    expect(agg.totals.tokens).toBeGreaterThan(0);
    expect(agg.totals.requests).toBeGreaterThan(0);
    expect(agg.windows.today.tokens).toBeGreaterThan(0);
    expect(agg.sites.some((row) => row.site === "direct")).toBe(true);

    const state = costMeterGetState();
    expect(state.balance.status).toBe("off");

    const ledger = loadLedger();
    ledger.balanceCache = {
      ...emptyDeepSeekBalance("err", "Balance HTTP 401"),
      fetchedAt: Date.now(),
      currency: "CNY",
    };
    saveLedger(ledger);
    expect(costMeterGetState().balance.status).toBe("error");
    expect(costMeterGetState().balance.message).toBe("Balance HTTP 401");
    void runtime;
  });
});
