/**
 * Append provider usage samples into the cost-meter ledger (live + import).
 */
import type { SessionStore } from "@xrkseek/core-session";
import type { SessionEvent, TokenUsage } from "@xrkseek/protocol";
import {
  buildCostMeterState,
  type CostMeterBuckets,
  type CostMeterDay,
  type CostMeterState,
  type CostMeterUsageSample,
  emptyDay,
  loadLedger,
  saveLedger,
  type LedgerFile,
} from "./cost-meter-store.js";
import { estimateUsageCostUsd } from "./cost-meter-pricing.js";

function dayKeyFromTs(ts: number): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function providerModelKey(provider: string, model: string): string {
  return `${provider}:${model}`;
}

function bucketsFromUsage(usage: TokenUsage): Omit<CostMeterBuckets, "cost"> {
  return {
    input: usage.inputTokens,
    output: usage.outputTokens,
    cacheRead: usage.cacheReadTokens ?? 0,
    cacheWrite: usage.cacheWriteTokens ?? 0,
    reasoning: usage.reasoningTokens ?? 0,
  };
}

function emptyBuckets(): CostMeterBuckets {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    reasoning: 0,
    cost: 0,
  };
}

function mergeBuckets(
  base: CostMeterBuckets,
  delta: CostMeterBuckets,
  sign: 1 | -1,
): CostMeterBuckets {
  return {
    input: base.input + sign * delta.input,
    output: base.output + sign * delta.output,
    cacheRead: base.cacheRead + sign * delta.cacheRead,
    cacheWrite: base.cacheWrite + sign * delta.cacheWrite,
    reasoning: base.reasoning + sign * delta.reasoning,
    cost: base.cost + sign * delta.cost,
  };
}

function ensureDay(history: CostMeterDay[], date: string): CostMeterDay {
  let row = history.find((d) => d.date === date);
  if (!row) {
    row = emptyDay(date);
    history.push(row);
  }
  return row;
}

function findSessionRow(
  day: CostMeterDay,
  sessionId: string,
  provider: string,
  model: string,
): Record<string, unknown> {
  let row = day.sessions.find((s) => s.id === sessionId);
  if (!row) {
    row = {
      id: sessionId,
      provider,
      model,
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      reasoning: 0,
      calls: 0,
      cost: 0,
      lastAt: 0,
      byModel: {},
      byProviderModel: {},
    };
    day.sessions.push(row);
  }
  return row;
}

function applyBucketsToMap(
  map: Record<string, CostMeterBuckets>,
  key: string,
  delta: CostMeterBuckets,
  sign: 1 | -1,
): void {
  map[key] = mergeBuckets(map[key] ?? emptyBuckets(), delta, sign);
}

function applySampleToDay(
  day: CostMeterDay,
  sample: CostMeterUsageSample,
  sign: 1 | -1,
  incrementCalls: boolean,
): void {
  const buckets = {
    input: sample.input,
    output: sample.output,
    cacheRead: sample.cacheRead,
    cacheWrite: sample.cacheWrite,
    reasoning: sample.reasoning,
    cost: sample.cost,
  };
  const pm = providerModelKey(sample.provider, sample.model);
  day.input += sign * buckets.input;
  day.output += sign * buckets.output;
  day.cacheRead += sign * buckets.cacheRead;
  day.cacheWrite += sign * buckets.cacheWrite;
  day.reasoning += sign * buckets.reasoning;
  day.cost += sign * buckets.cost;
  if (sign === 1 && incrementCalls) day.calls += 1;
  if (sign === -1 && incrementCalls) day.calls = Math.max(0, day.calls - 1);
  applyBucketsToMap(day.byProviderModel, pm, buckets, sign);
  applyBucketsToMap(day.byModel, sample.model, buckets, sign);

  const session = findSessionRow(
    day,
    sample.sessionId,
    sample.provider,
    sample.model,
  );
  session.input = Number(session.input ?? 0) + sign * buckets.input;
  session.output = Number(session.output ?? 0) + sign * buckets.output;
  session.cacheRead = Number(session.cacheRead ?? 0) + sign * buckets.cacheRead;
  session.cacheWrite =
    Number(session.cacheWrite ?? 0) + sign * buckets.cacheWrite;
  session.reasoning =
    Number(session.reasoning ?? 0) + sign * buckets.reasoning;
  session.cost = Number(session.cost ?? 0) + sign * buckets.cost;
  if (sign === 1 && incrementCalls) {
    session.calls = Number(session.calls ?? 0) + 1;
  }
  if (sign === -1 && incrementCalls) {
    session.calls = Math.max(0, Number(session.calls ?? 0) - 1);
  }
  if (sign === 1) {
    session.lastAt = sample.ts;
    session.provider = sample.provider;
    session.model = sample.model;
  }
  const sessByPm =
    (session.byProviderModel as Record<string, CostMeterBuckets> | undefined) ??
    {};
  applyBucketsToMap(sessByPm, pm, buckets, sign);
  session.byProviderModel = sessByPm;
  const sessByModel =
    (session.byModel as Record<string, CostMeterBuckets> | undefined) ?? {};
  applyBucketsToMap(sessByModel, sample.model, buckets, sign);
  session.byModel = sessByModel;
}

function pruneHistory(ledger: LedgerFile): void {
  const keep =
    typeof ledger.config.historyDays === "number" &&
    Number.isFinite(ledger.config.historyDays)
      ? Math.max(1, Math.floor(ledger.config.historyDays))
      : 180;
  if (ledger.history.length <= keep) return;
  ledger.history.sort((a, b) => a.date.localeCompare(b.date));
  ledger.history = ledger.history.slice(-keep);
}

function sampleKey(sample: CostMeterUsageSample): string {
  return `${sample.sessionId}:${sample.turnId}:${sample.stepId}`;
}

export function applyCostMeterUsageSample(sample: CostMeterUsageSample): void {
  const ledger = loadLedger();
  const cost =
    sample.cost > 0
      ? sample.cost
      : estimateUsageCostUsd(sample, ledger.config);
  const enriched: CostMeterUsageSample = { ...sample, cost };
  const key = sampleKey(enriched);
  const prev = ledger.pendingByKey?.[key];
  if (prev) {
    const prevDay = ensureDay(ledger.history, dayKeyFromTs(prev.ts));
    applySampleToDay(prevDay, prev, -1, true);
  }
  const day = ensureDay(ledger.history, dayKeyFromTs(enriched.ts));
  applySampleToDay(day, enriched, 1, !prev);
  ledger.pendingByKey = { ...(ledger.pendingByKey ?? {}), [key]: enriched };
  pruneHistory(ledger);
  saveLedger(ledger);
}

export function usageSampleFromMessage(
  sessionId: string,
  event: SessionEvent,
  provider: string,
  model: string,
): CostMeterUsageSample | undefined {
  if (event.type !== "assistant/message" || !event.usage) return undefined;
  const buckets = bucketsFromUsage(event.usage);
  const cost = estimateUsageCostUsd(
    { provider, model, ...buckets },
    loadLedger().config,
  );
  return {
    sessionId,
    turnId: event.turnId,
    stepId: event.stepId,
    ts: event.ts,
    provider,
    model,
    ...buckets,
    cost,
  };
}

export function costMeterImportLegacyHistoryFromStore(
  store: SessionStore,
  sessionModels: ReadonlyMap<string, { provider: string; model: string }>,
): {
  ok: boolean;
  message: string;
  imported: number;
  skipped: number;
  state: CostMeterState;
} {
  const ledger = loadLedger();
  let imported = 0;
  let skipped = 0;

  for (const sessionId of store.list()) {
    let provider = sessionModels.get(sessionId)?.provider ?? "deepseek";
    let model = sessionModels.get(sessionId)?.model ?? "unknown";
    for (const event of store.get(sessionId).events) {
      if (event.type === "request/header") {
        provider = event.header.config.provider;
        model = event.header.config.model;
      }
      const sample = usageSampleFromMessage(sessionId, event, provider, model);
      if (!sample) continue;
      const key = sampleKey(sample);
      if (ledger.pendingByKey?.[key]) {
        skipped += 1;
        continue;
      }
      const enriched: CostMeterUsageSample = {
        ...sample,
        cost:
          sample.cost > 0
            ? sample.cost
            : estimateUsageCostUsd(sample, ledger.config),
      };
      const day = ensureDay(ledger.history, dayKeyFromTs(enriched.ts));
      applySampleToDay(day, enriched, 1, true);
      ledger.pendingByKey = {
        ...(ledger.pendingByKey ?? {}),
        [key]: enriched,
      };
      imported += 1;
    }
  }

  pruneHistory(ledger);
  saveLedger(ledger);
  return {
    ok: true,
    message:
      imported > 0
        ? `imported ${imported} usage sample(s) from session log`
        : skipped > 0
          ? `no new samples (${skipped} already recorded)`
          : "no usage samples found in session log",
    imported,
    skipped,
    state: buildCostMeterState(ledger),
  };
}
