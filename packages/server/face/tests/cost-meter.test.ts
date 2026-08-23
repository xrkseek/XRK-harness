import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createMemorySessionStore } from "@xrkseek/core-session";
import {
  configureCostMeterHome,
  costMeterGetState,
  costMeterResetHistory,
} from "../src/cost-meter-store.js";
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

  it("costMeter/importLegacyHistory Face remote returns Typert envelope", async () => {
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
    const nested = res.result.value as {
      ok: boolean;
      value: { imported: number };
    };
    expect(nested.ok).toBe(true);
    expect(nested.value.imported).toBe(1);
  });
});
