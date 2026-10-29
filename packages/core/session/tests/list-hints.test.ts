import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SessionEvent } from "@xrkseek/protocol";
import {
  createPersistentSessionStore,
  forkSession,
  SESSION_DB_FILENAME,
} from "../src/index.js";

// `node:sqlite` cannot go through a static import here: Vite rewrites the
// specifier and fails to resolve it. A runtime require keeps the store's own
// DependencyAndPredicate-free path intact and lets the test read the physical
// hint row the store maintains.
interface SqliteDb {
  prepare(query: string): { get(...params: unknown[]): unknown };
  close(): void;
}
const requireNode = createRequire(import.meta.url);
const { DatabaseSync } = requireNode("node:sqlite") as {
  DatabaseSync: new (
    filename: string,
    options?: { readonly?: boolean },
  ) => SqliteDb;
};

interface HintRow {
  last_ts: number;
  event_count: number;
  has_turn_start: number;
  has_command_run: number;
}

/** Read the maintained hint row straight from the physical database. */
function readHintRow(dir: string, id: string): HintRow | undefined {
  const db = new DatabaseSync(path.join(dir, SESSION_DB_FILENAME), {
    readonly: true,
  });
  try {
    return db
      .prepare(
        "SELECT last_ts, event_count, has_turn_start, has_command_run FROM sessions WHERE id = ?",
      )
      .get(id) as HintRow | undefined;
  } finally {
    db.close();
  }
}

const dirs: string[] = [];
const openStores: Array<{ close(): void }> = [];

afterEach(() => {
  while (openStores.length > 0) openStores.pop()!.close();
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "xrk-hints-"));
  dirs.push(dir);
  return dir;
}

function track<T extends { close(): void }>(store: T): T {
  openStores.push(store);
  return store;
}

const LOG: readonly SessionEvent[] = [
  { type: "turn/start", ts: 1, turnId: "t1" },
  { type: "user/message", ts: 2, turnId: "t1", content: "hi" },
];

describe("session list hints", () => {
  it("seeds hints for a forked child so a title rename cannot blank it", () => {
    // `seed` writes events but used to skip the hint columns, leaving the child
    // at event_count 0 / has_turn_start 0. The hint reader only treats <= 0 as
    // "unknown", so the fork's own title rename (a non-turn-start append) made
    // event_count 1 and froze `blank: true` — the sidebar then offered that
    // long branch to the New Session button.
    const dir = tempDir();
    const store = track(createPersistentSessionStore(dir));
    store.seed("parent", LOG);
    forkSession(store, "parent", undefined, "child");
    // Mirrors the post-fork rename the product shell sends.
    store.append("child", {
      type: "user/message",
      ts: 3,
      turnId: "t2",
      content: "again",
    });
    store.close();

    // Cold read: a resident session folds its in-memory log and never touches
    // the hint columns, which is exactly the state that hid this bug.
    const reopened = track(createPersistentSessionStore(dir));
    const hints = reopened.listHints("child");
    expect(hints.hasTurnStart).toBe(true);
    // Fork appends `session/end-seed` with `Date.now()`; a later user message
    // at ts=3 does not lower `last_ts` (MAX). Assert activity + count instead.
    expect(hints.eventCount).toBeGreaterThanOrEqual(3);
    expect(hints.lastEventTs).toBeGreaterThanOrEqual(3);
  });

  it("carries hints through an archive round-trip", () => {
    // Offload/restore copies rows between sessions.db and sessions-archive.db.
    // Copying only `id` zeroed every hint permanently (the v4 backfill runs on
    // a schema bump only), so archived sessions rescanned on every list and
    // lost their updatedAt ordering. `listHints` cannot show this: with a zero
    // row it silently falls back to three table scans and still answers right.
    // Read the physical row instead.
    const dir = tempDir();
    const store = track(createPersistentSessionStore(dir));
    store.seed("arch", LOG);
    store.offloadToArchive("arch");
    store.restoreFromArchive("arch");
    store.flush();

    expect(readHintRow(dir, "arch")).toMatchObject({
      last_ts: 2,
      event_count: 2,
      has_turn_start: 1,
    });
  });
});
