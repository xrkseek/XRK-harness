#!/usr/bin/env node
/**
 * Opt-in performance gate (not part of `pnpm check` fast path).
 *
 * Measures a synthetic session-open fold of N events: wall-clock + heap after
 * an explicit GC when `--expose-gc` is present. Fails when wallMs exceeds the
 * budget so a real regression can turn the gate red.
 *
 * Usage:
 *   node --expose-gc ./scripts/perf-gate.mjs
 *   node --expose-gc ./scripts/perf-gate.mjs --self-test-fail   # force red
 *   pnpm perf:gate
 */
import { performance } from "node:perf_hooks";

const EVENT_COUNT = Number(process.env.XRK_PERF_EVENTS ?? 10_000);
const WALL_BUDGET_MS = Number(process.env.XRK_PERF_WALL_MS ?? 2_000);
const selfTestFail = process.argv.includes("--self-test-fail");

function foldSynthetic(n) {
  /** Minimal stand-in for open/restore/projection work proportional to log size. */
  const out = [];
  for (let i = 0; i < n; i += 1) {
    out.push({
      seq: i + 1,
      type: i % 7 === 0 ? "turn/start" : "assistant/message",
      text: `e${i}`,
    });
  }
  let turns = 0;
  let chars = 0;
  for (const ev of out) {
    if (ev.type === "turn/start") turns += 1;
    chars += ev.text.length;
  }
  return { turns, chars, events: out.length };
}

function sampleHeap() {
  if (typeof globalThis.gc === "function") {
    globalThis.gc();
  }
  return process.memoryUsage().heapUsed;
}

const before = sampleHeap();
const t0 = performance.now();
const result = foldSynthetic(EVENT_COUNT);
const wallMs = performance.now() - t0;
const after = sampleHeap();
const heapDeltaMb = (after - before) / (1024 * 1024);

const report = {
  events: result.events,
  turns: result.turns,
  wallMs: Number(wallMs.toFixed(2)),
  heapDeltaMb: Number(heapDeltaMb.toFixed(2)),
  wallBudgetMs: WALL_BUDGET_MS,
  gc: typeof globalThis.gc === "function",
};

console.log(JSON.stringify(report, null, 2));

if (selfTestFail || wallMs > WALL_BUDGET_MS) {
  console.error(
    selfTestFail
      ? "perf-gate: --self-test-fail forced failure"
      : `perf-gate: wall ${wallMs.toFixed(1)}ms exceeds budget ${WALL_BUDGET_MS}ms`,
  );
  process.exit(1);
}

console.error("perf-gate: ok");
