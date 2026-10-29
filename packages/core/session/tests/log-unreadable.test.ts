// An unreadable row must stop the load instead of shrinking the log.
//
// The store runs crash repair over whatever `loadSessionEvents` returns, and
// that repair *writes* a synthetic `turn/end` back to disk. A silent `break`
// on a bad row therefore does not merely hide history for one read — it
// fabricates a turn boundary and pushes every surviving event behind it.
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createPersistentSessionStore, SessionLogUnreadableError } from "../src/index.js";

interface Statement {
  get(...p: unknown[]): unknown;
  all(...p: unknown[]): unknown[];
  run(...p: unknown[]): unknown;
}
interface Db {
  prepare(q: string): Statement;
  close(): void;
}
const requireNode = createRequire(import.meta.url);
const { DatabaseSync } = requireNode("node:sqlite") as {
  DatabaseSync: new (f: string, o?: { readonly?: boolean }) => Db;
};

let dir = "";

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "xrk-unreadable-"));
});

afterEach(() => {
  // Windows may still hold the WAL/shm handles for a moment.
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  } catch {
    /* temp dir */
  }
});

function countTurnEnds(): number {
  const db = new DatabaseSync(path.join(dir, "sessions.db"));
  try {
    // `payload LIKE` rather than `json_extract`: the deliberately corrupt row
    // is not valid JSON, and json_extract would abort the whole scan.
    const row = db
      .prepare("SELECT COUNT(*) AS c FROM events WHERE payload LIKE '%\"turn/end\"%'")
      .get() as { c: number };
    return row.c;
  } finally {
    db.close();
  }
}

it("throws on an unreadable row and never repairs the truncated view", () => {
  const seeded = createPersistentSessionStore(dir);
  const id = seeded.create("s").id;
  seeded.append(id, { type: "turn/start", ts: 1, turnId: "t1" });
  seeded.append(id, {
    type: "assistant/chunk",
    ts: 2,
    turnId: "t1",
    stepId: "s1",
    kind: "text",
    text: "hello ",
    index: 0,
  });
  seeded.flush();
  seeded.close();

  // Corrupt the last row: the log now ends with something this build cannot
  // read, and the turn above is still open in durable storage.
  const writer = new DatabaseSync(path.join(dir, "sessions.db"));
  writer
    .prepare("UPDATE events SET payload = ? WHERE session_id = ? AND seq = (SELECT MAX(seq) FROM events WHERE session_id = ?)")
    .run("not-json", id, id);
  writer.close();

  const store = createPersistentSessionStore(dir);
  expect(() => store.readEvents(id)).toThrow(SessionLogUnreadableError);
  try {
    store.readEvents(id);
  } catch (error) {
    // The error names the session and the position, so a caller can say which
    // log is unreadable instead of blaming the whole store.
    expect((error as SessionLogUnreadableError).sessionId).toBe(id);
    expect((error as SessionLogUnreadableError).seq).toBeGreaterThan(0);
  }
  store.close();

  // The decisive assertion: crash repair did not append a fabricated closer.
  expect(countTurnEnds()).toBe(0);
});
