// Temporary check: packed text rows must be indexed once, and search must
// still hit them. Delete after reading.
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { createPersistentSessionStore } from "../src/index.js";

interface Db {
  prepare(q: string): { get(...p: unknown[]): unknown };
  close(): void;
}
const requireNode = createRequire(import.meta.url);
const { DatabaseSync } = requireNode("node:sqlite") as {
  DatabaseSync: new (f: string, o?: { readonly?: boolean }) => Db;
};

it("indexes packed text rows once and still matches", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "xrk-fts-"));
  const store = createPersistentSessionStore(dir);
  const id = store.create("s").id;
  store.append(id, { type: "turn/start", ts: 0, turnId: "t1" });
  for (let i = 0; i < 200; i++) {
    store.append(id, {
      type: "assistant/chunk",
      ts: i + 1,
      turnId: "t1",
      stepId: "s1",
      text: `token${i} `,
      kind: "text",
      index: 0,
    });
  }
  store.flush();

  const db = new DatabaseSync(path.join(dir, "sessions.db"), { readonly: true });
  const events = (
    db.prepare("SELECT COUNT(*) AS c FROM events WHERE session_id = ?").get(id) as { c: number }
  ).c;
  const fts = (
    db.prepare("SELECT COUNT(*) AS c FROM search_fts WHERE session_id = ?").get(id) as { c: number }
  ).c;
  db.close();

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ events, fts }));

  // One FTS row per stored row at most (packed text rows are covered by the
  // joined row; nothing is indexed twice).
  expect(fts).toBeLessThanOrEqual(events);
  // Recall survives: a token from the middle and one from the tail both hit.
  expect(store.searchSessionIds("token42")).toContain(id);
  expect(store.searchSessionIds("token199")).toContain(id);
  // A packed row still exists (sanity: this session is not 200 loose rows).
  expect(events).toBeLessThan(200);

  store.close();
  rmSync(dir, { recursive: true, force: true });
}, 120_000);
