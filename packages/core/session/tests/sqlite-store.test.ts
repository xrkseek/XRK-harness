import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createPersistentSessionStore,
  SESSION_DB_FILENAME,
  SESSION_SCHEMA_VERSION,
  toJSONL,
} from "../src/index.js";

const dirs: string[] = [];
const openStores: Array<{ close(): void }> = [];

afterEach(() => {
  while (openStores.length > 0) {
    openStores.pop()!.close();
  }
  while (dirs.length > 0) {
    rmSync(dirs.pop()!, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "xrk-sqlite-"));
  dirs.push(dir);
  return dir;
}

function track<T extends { close(): void }>(store: T): T {
  openStores.push(store);
  return store;
}

describe("createPersistentSessionStore", () => {
  it("persists events and reloads from sessions.db", () => {
    const dir = tempDir();
    const a = track(createPersistentSessionStore(dir));
    const s = a.create("sess-a");
    a.append(s.id, {
      type: "user/message",
      ts: 1,
      turnId: "t1",
      content: "hi",
    });
    expect(existsSync(path.join(dir, SESSION_DB_FILENAME))).toBe(true);

    const b = track(createPersistentSessionStore(dir));
    expect(b.list()).toEqual(["sess-a"]);
    expect(b.get("sess-a").events).toHaveLength(1);
  });

  it("survives unrelated files in the sessions directory", () => {
    const dir = tempDir();
    const store = track(createPersistentSessionStore(dir));
    const s = store.create();
    store.append(s.id, {
      type: "turn/start",
      ts: 1,
      turnId: "t",
    });
    store.append(s.id, {
      type: "turn/end",
      ts: 2,
      turnId: "t",
      reason: { kind: "completed" },
    });
    writeFileSync(path.join(dir, "noop.txt"), "");
    const reloaded = track(createPersistentSessionStore(dir));
    expect(reloaded.get(s.id).events).toHaveLength(2);
  });

  it("export jsonl remains possible via toJSONL", () => {
    const dir = tempDir();
    const store = track(createPersistentSessionStore(dir));
    const s = store.create("export-me");
    store.append(s.id, {
      type: "user/message",
      ts: 3,
      turnId: "t",
      content: "zip",
    });
    const jsonl = toJSONL(store.get(s.id).events);
    expect(jsonl).toContain("zip");
    expect(readFileSync(path.join(dir, SESSION_DB_FILENAME)).byteLength).toBeGreaterThan(0);
  });

  it("indexes searchable text with FTS5 trigram", () => {
    const dir = tempDir();
    const store = track(createPersistentSessionStore(dir));
    const hit = store.create("hit");
    const miss = store.create("miss");
    store.append(hit.id, {
      type: "user/message",
      ts: 1,
      turnId: "t1",
      content: "find me unique-fts-token please",
    });
    store.append(miss.id, {
      type: "user/message",
      ts: 2,
      turnId: "t2",
      content: "nothing here",
    });
    expect(store.searchSessionIds("unique-fts-token")).toEqual(["hit"]);
    expect(store.searchSessionIds("no-such-token")).toEqual([]);

    const reloaded = track(createPersistentSessionStore(dir));
    expect(reloaded.searchSessionIds("fts-token")).toEqual(["hit"]);
  });

  it("repairs open turn on lazy reload after crash", () => {
    const dir = tempDir();
    const a = createPersistentSessionStore(dir);
    const s = a.create("crash");
    a.append(s.id, { type: "turn/start", ts: 1, turnId: "t1" });
    a.append(s.id, { type: "step/start", ts: 2, turnId: "t1", stepId: "s1" });
    a.append(s.id, {
      type: "assistant/chunk",
      ts: 3,
      turnId: "t1",
      stepId: "s1",
      text: "prefix",
      kind: "text",
      index: 0,
    });
    a.close();

    const b = track(createPersistentSessionStore(dir));
    const events = b.get("crash").events;
    expect(events.some((e) => e.type === "turn/end")).toBe(true);
    expect(events.some((e) => e.type === "assistant/message")).toBe(true);
  });

  it("lazy-loads session ids without loading all events on open", () => {
    const dir = tempDir();
    const a = createPersistentSessionStore(dir);
    const s1 = a.create("one");
    const s2 = a.create("two");
    a.append(s1.id, {
      type: "user/message",
      ts: 1,
      turnId: "t1",
      content: "only-one",
    });
    a.append(s2.id, {
      type: "user/message",
      ts: 2,
      turnId: "t2",
      content: "only-two",
    });
    a.close();

    const b = track(createPersistentSessionStore(dir));
    expect(b.list().sort()).toEqual(["one", "two"]);
    expect(b.get("one").events).toHaveLength(1);
    expect(b.get("two").events).toHaveLength(1);
  });

  it("packs ≥3 assistant/chunk into physical text-chunks on flush", () => {
    const dir = tempDir();
    const a = createPersistentSessionStore(dir);
    const s = a.create("pack");
    for (const [ts, text] of [
      [1, "aa"],
      [2, "bb"],
      [3, "cc"],
    ] as const) {
      a.append(s.id, {
        type: "assistant/chunk",
        ts,
        turnId: "t1",
        stepId: "s1",
        text,
        kind: "text",
        index: 0,
      });
    }
    a.append(s.id, {
      type: "assistant/message",
      ts: 4,
      turnId: "t1",
      stepId: "s1",
      content: "aabbcc",
    });
    expect(
      a.get(s.id).events.filter((e) => e.type === "assistant/chunk"),
    ).toHaveLength(3);
    a.close();

    const { DatabaseSync } = process.getBuiltinModule(
      "node:sqlite",
    ) as typeof import("node:sqlite");
    const db = new DatabaseSync(path.join(dir, SESSION_DB_FILENAME));
    try {
      const rows = db
        .prepare("SELECT payload FROM events WHERE session_id = ? ORDER BY seq")
        .all("pack") as { payload: string }[];
      expect(rows).toHaveLength(2);
      expect(JSON.parse(rows[0]!.payload)).toMatchObject({
        type: "text-chunks",
        texts: ["aa", "bb", "cc"],
      });
      const meta = db
        .prepare("SELECT value FROM meta WHERE key = 'schema_version'")
        .get() as { value: string };
      expect(Number(meta.value)).toBe(SESSION_SCHEMA_VERSION);
    } finally {
      db.close();
    }

    const b = track(createPersistentSessionStore(dir));
    expect(
      b.get("pack").events.filter((e) => e.type === "assistant/chunk"),
    ).toHaveLength(3);
  });

  it("flush() persists pending chunks without a trailing non-chunk", () => {
    const dir = tempDir();
    const a = createPersistentSessionStore(dir);
    const s = a.create("flush-me");
    a.append(s.id, {
      type: "assistant/chunk",
      ts: 1,
      turnId: "t",
      stepId: "s",
      text: "x",
      kind: "text",
      index: 0,
    });
    a.flush();
    a.close();

    const b = track(createPersistentSessionStore(dir));
    expect(b.get("flush-me").events).toHaveLength(1);
  });

  it("evicts oldest resident sessions when maxResidentSessions is exceeded", () => {
    const dir = tempDir();
    const evicted: string[] = [];
    const store = track(
      createPersistentSessionStore(dir, { maxResidentSessions: 2 }),
    );
    store.bindSessionEviction((id) => evicted.push(id));
    const s1 = store.create("s1").id;
    const s2 = store.create("s2").id;
    store.append(s1, { type: "turn/start", ts: 1, turnId: "t1" });
    store.append(s2, { type: "turn/start", ts: 2, turnId: "t2" });
    expect(store.isLoaded?.(s1)).toBe(true);
    expect(store.isLoaded?.(s2)).toBe(true);

    const s3 = store.create("s3").id;
    store.append(s3, { type: "turn/start", ts: 3, turnId: "t3" });
    expect(store.isLoaded?.(s3)).toBe(true);
    expect(store.isLoaded?.(s1)).toBe(false);
    expect(store.isLoaded?.(s2)).toBe(true);
    expect(evicted).toContain("s1");
  });
});
