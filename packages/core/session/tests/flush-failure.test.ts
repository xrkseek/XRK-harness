// Background flush must pause loudly (DSH): retain pending, report, resume on flush().
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPersistentSessionStore,
  SESSION_DB_FILENAME,
} from "../src/index.js";

interface Db {
  exec(q: string): void;
  prepare(q: string): { get(...args: unknown[]): unknown };
  close(): void;
}
const requireNode = createRequire(import.meta.url);
const { DatabaseSync } = requireNode("node:sqlite") as {
  DatabaseSync: new (f: string) => Db;
};

let dir = "";

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "xrk-flush-fail-"));
});

afterEach(() => {
  vi.restoreAllMocks();
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  } catch {
    /* temp dir */
  }
});

describe("background flush failure", () => {
  it("pauses auto-drain, keeps pending, recovers on explicit flush", async () => {
    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    });

    const store = createPersistentSessionStore(dir);
    const id = store.create("s").id;
    store.flush(id);

    const locker = new DatabaseSync(path.join(dir, SESSION_DB_FILENAME));
    locker.exec("BEGIN IMMEDIATE");

    store.append(id, { type: "turn/start", ts: 1, turnId: "t1" });
    // Durability boundary schedules a microtask flush — let it run under the lock.
    await Promise.resolve();
    await Promise.resolve();

    const report = store.flushFailureReport();
    expect(report.paused).toBe(true);
    expect(report.failures).toBeGreaterThanOrEqual(1);
    expect(report.lastError).toBeTruthy();
    expect(errors.some((line) => line.includes("background flush failed"))).toBe(
      true,
    );
    // Still visible in memory; not silently dropped.
    expect(store.get(id).events).toHaveLength(1);

    locker.exec("COMMIT");
    locker.close();

    store.flush(id);
    expect(store.flushFailureReport()).toEqual({
      failures: report.failures,
      paused: false,
    });
    expect(store.get(id).events).toHaveLength(1);

    store.close();

    const verify = new DatabaseSync(path.join(dir, SESSION_DB_FILENAME));
    const row = verify
      .prepare(
        "SELECT COUNT(*) AS n FROM events WHERE session_id = ?",
      )
      .get(id) as { n: number };
    expect(row.n).toBe(1);
    verify.close();
  });
});
