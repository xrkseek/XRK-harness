#!/usr/bin/env node
/**
 * Opt-in performance gate (not part of `pnpm check` fast path).
 *
 * Two modes:
 *
 *   pnpm perf:gate                 real-store bench on a throwaway directory
 *   pnpm perf:gate -- --dir <dir>  read-only health report for a real
 *                                  `sessions/` directory (default: ~/.xrk/sessions)
 *
 * The bench used to fold a hand-written array — it could not go red for any
 * change to this repo. It now drives `createPersistentSessionStore` from
 * `packages/core/session/dist`, so append/flush throughput, cold read, the
 * list hints, and WAL reclaim are measured on the real code path.
 *
 * Budgets (override with XRK_PERF_*): the numbers below are ~5x the values
 * measured on a developer laptop for 10k events, so only a structural
 * regression (an extra full-log scan, a lost index, a synchronous fsync per
 * event) turns the gate red.
 *
 * Usage:
 *   node --expose-gc ./scripts/perf-gate.mjs
 *   node --expose-gc ./scripts/perf-gate.mjs --self-test-fail   # force red
 *   node ./scripts/perf-gate.mjs --dir "$HOME/.xrk/sessions"
 *   pnpm perf:gate
 */
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

const EVENT_COUNT = Number(process.env.XRK_PERF_EVENTS ?? 10_000);
const WRITE_BUDGET_MS = Number(process.env.XRK_PERF_WRITE_MS ?? 4_000);
const COLD_READ_BUDGET_MS = Number(process.env.XRK_PERF_COLD_MS ?? 1_000);
const selfTestFail = process.argv.includes("--self-test-fail");
const dirArgIndex = process.argv.indexOf("--dir");
const healthDir =
  dirArgIndex === -1 ? undefined : process.argv[dirArgIndex + 1] ?? "";

/** `-wal` size, 0 when absent. */
function walBytes(file) {
  try {
    return statSync(`${file}-wal`).size;
  } catch {
    return 0;
  }
}

function mb(bytes) {
  return Number((bytes / (1024 * 1024)).toFixed(1));
}

/** Minimal events that `assertSessionEvent` accepts; chunk rows dominate real logs. */
function makeEvent(i) {
  const ts = 1_700_000_000_000 + i;
  if (i % 50 === 0) {
    return { type: "user/message", ts, turnId: `t${i}`, content: `prompt ${i}` };
  }
  return {
    type: "assistant/chunk",
    ts,
    turnId: `t${i}`,
    stepId: `s${i}`,
    text: `chunk ${i} `.repeat(6),
    kind: "text",
    index: 1,
  };
}

async function loadStore() {
  const url = new URL("../packages/core/session/dist/index.js", import.meta.url);
  if (!existsSync(url)) {
    throw new Error(
      `perf-gate: ${url.pathname} missing — run \`pnpm build\` (or use --dir for the read-only report)`,
    );
  }
  return import(url.href);
}

async function runBench() {
  const { createPersistentSessionStore } = await loadStore();
  const dir = mkdtempSync(path.join(os.tmpdir(), "xrk-perf-"));
  const dbFile = path.join(dir, "sessions.db");
  const report = { events: EVENT_COUNT, dir };
  let store;
  try {
    store = createPersistentSessionStore(dir, {
      // Lowered so the reclaim path is exercised by a bench-sized WAL.
      walShrinkMinBytes: 256 * 1024,
      walShrinkIntervalMs: 0,
    });
    const session = store.create("perf-session");

    const t0 = performance.now();
    for (let i = 0; i < EVENT_COUNT; i += 1) store.append(session.id, makeEvent(i));
    store.flush();
    report.writeMs = Number((performance.now() - t0).toFixed(1));
    report.walAfterFlushBytes = walBytes(dbFile);
    report.dbBytes = statSync(dbFile).size;

    const t1 = performance.now();
    store.list();
    report.listMs = Number((performance.now() - t1).toFixed(3));

    const t2 = performance.now();
    const loaded = store.get(session.id);
    report.coldReadMs = Number((performance.now() - t2).toFixed(3));
    report.readEvents = loaded.events.length;

    store.close();
    store = undefined;
    // `close()` truncates the WAL: the file must be gone or empty.
    report.walAfterCloseBytes = walBytes(dbFile);
  } finally {
    store?.close();
    rmSync(dir, { recursive: true, force: true });
  }

  console.log(JSON.stringify(report, null, 2));
  const failures = [];
  if (report.readEvents !== EVENT_COUNT) {
    failures.push(`read ${report.readEvents} of ${EVENT_COUNT} events`);
  }
  if (report.writeMs > WRITE_BUDGET_MS) {
    failures.push(`write ${report.writeMs}ms > ${WRITE_BUDGET_MS}ms`);
  }
  if (report.coldReadMs > COLD_READ_BUDGET_MS) {
    failures.push(`cold read ${report.coldReadMs}ms > ${COLD_READ_BUDGET_MS}ms`);
  }
  if (report.walAfterCloseBytes > 0) {
    failures.push(`WAL not reclaimed on close (${report.walAfterCloseBytes} B)`);
  }
  return failures;
}

/**
 * Read-only health report for a live `sessions/` directory. Answers the two
 * questions a user actually has: how much disk is the WAL holding, and what is
 * inside the database.
 */
function reportHealth(dir) {
  const dbFile = path.join(dir, "sessions.db");
  if (!existsSync(dbFile)) throw new Error(`perf-gate: no sessions.db in ${dir}`);
  const { DatabaseSync } = process.getBuiltinModule("node:sqlite");
  const db = new DatabaseSync(dbFile, { readOnly: true });
  const report = {
    dir,
    dbMb: mb(statSync(dbFile).size),
    walMb: mb(walBytes(dbFile)),
    archiveMb: mb(
      existsSync(path.join(dir, "sessions-archive.db"))
        ? statSync(path.join(dir, "sessions-archive.db")).size
        : 0,
    ),
  };
  const one = (sql) => db.prepare(sql).get();
  report.sessions = one("select count(*) as n from sessions").n;
  report.eventRows = one("select count(*) as n from events").n;
  report.eventPayloadMb = mb(one("select sum(length(payload)) as b from events").b ?? 0);
  report.topEventTypes = db
    .prepare(
      `select json_extract(payload,'$.type') as type, count(*) as n, sum(length(payload)) as bytes
       from events group by type order by bytes desc limit 8`,
    )
    .all()
    .map((r) => ({ type: r.type, count: r.n, mb: mb(r.bytes) }));
  try {
    const tables = db
      .prepare("select name, sum(pgsize) as bytes from dbstat group by name order by bytes desc limit 6")
      .all();
    report.tables = tables.map((r) => ({ name: r.name, mb: mb(r.bytes) }));
  } catch {
    // dbstat is optional in some SQLite builds.
  }
  db.close();
  console.log(JSON.stringify(report, null, 2));
  if (report.walMb > 64) {
    console.error(
      `perf-gate: ${report.walMb} MB of WAL is waiting for a TRUNCATE checkpoint ` +
        "(it is reclaimed on the next Host close or idle flush; this is disk held, not lost data)",
    );
  }
  return [];
}

const failures = healthDir === undefined ? await runBench() : reportHealth(healthDir);
if (selfTestFail) failures.push("--self-test-fail forced failure");
if (failures.length > 0) {
  for (const failure of failures) console.error(`perf-gate: ${failure}`);
  process.exit(1);
}
console.error("perf-gate: ok");
