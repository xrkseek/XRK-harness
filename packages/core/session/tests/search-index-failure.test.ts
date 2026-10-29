// A broken FTS index must not read as "no results".
//
// `searchSessionIds` used to swallow every FTS error ("corrupt / missing FTS —
// skip that DB"), so a dropped or damaged index made search return an empty
// list forever with no diagnostic — indistinguishable from a real miss.
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionEvent } from "@xrkseek/protocol";
import { createPersistentSessionStore } from "../src/index.js";

interface Db {
  exec(q: string): void;
  close(): void;
}
const requireNode = createRequire(import.meta.url);
const { DatabaseSync } = requireNode("node:sqlite") as {
  DatabaseSync: new (f: string) => Db;
};

let dir = "";

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "xrk-fts-broken-"));
});

afterEach(() => {
  vi.restoreAllMocks();
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  } catch {
    /* temp dir */
  }
});

describe("searchSessionIds with a broken index", () => {
  it("falls back to resident logs and says so", () => {
    const store = createPersistentSessionStore(dir);
    const id = store.create("s").id;
    store.append(id, { type: "turn/start", ts: 1, turnId: "t1" });
    store.append(id, {
      type: "assistant/chunk",
      ts: 2,
      turnId: "t1",
      stepId: "s1",
      kind: "text",
      text: "今天部署完成 ",
      index: 0,
    } as SessionEvent);
    store.flush();

    // Break the index the way a damaged file would: the table is gone.
    const db = new DatabaseSync(path.join(dir, "sessions.db"));
    db.exec("DROP TABLE search_fts");
    db.close();

    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    });

    // Resident log is still there, so the hit survives the broken index.
    expect(store.searchSessionIds("部署")).toContain(id);
    expect(errors.some((line) => line.includes("search index unavailable"))).toBe(true);

    store.close();
  });
});
