// A newer schema must be refused, not opened.
//
// `stored >= SCHEMA_VERSION` used to return early, so a build that predates the
// file opened it and read/wrote it under the old shape: columns the new build
// added are invisible to it, and rows it rewrites lose whatever the new build
// meant by them. The file is fine — this build is what cannot read it.
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createPersistentSessionStore } from "../src/index.js";

interface Db {
  prepare(q: string): { run(...p: unknown[]): unknown; get(...p: unknown[]): unknown };
  close(): void;
}
const requireNode = createRequire(import.meta.url);
const { DatabaseSync } = requireNode("node:sqlite") as {
  DatabaseSync: new (f: string, o?: { readonly?: boolean }) => Db;
};

let dir = "";

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "xrk-schema-future-"));
});

afterEach(() => {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  } catch {
    /* temp dir */
  }
});

it("refuses a sessions.db written by a newer build, without touching it", () => {
  const seeded = createPersistentSessionStore(dir);
  const id = seeded.create("s").id;
  seeded.append(id, { type: "turn/start", ts: 1, turnId: "t1" });
  seeded.flush();
  seeded.close();

  const dbPath = path.join(dir, "sessions.db");
  const writer = new DatabaseSync(dbPath);
  writer
    .prepare("INSERT INTO meta (key, value) VALUES ('schema_version', '99') ON CONFLICT(key) DO UPDATE SET value = '99'")
    .run();
  writer.close();

  const before = { size: statSync(dbPath).size, bytes: readFileSync(dbPath).length };

  expect(() => createPersistentSessionStore(dir)).toThrow(/newer than this build/);
  // Refusal is read-only: the "unsupported file" is still exactly as it was.
  expect(statSync(dbPath).size).toBeGreaterThan(0);
  expect(readFileSync(dbPath).length).toBe(before.bytes);
  expect(before.size).toBeGreaterThan(0);
});
