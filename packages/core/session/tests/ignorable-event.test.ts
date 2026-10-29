// Forward-compat: unknown rows with `ignorable: true` must be skipped; without
// the flag the load still refuses so crash repair cannot rewrite a truncated view.
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseSessionEvent, SessionEventParseError } from "@xrkseek/protocol";
import {
  createPersistentSessionStore,
  SESSION_DB_FILENAME,
  SessionLogUnreadableError,
} from "../src/index.js";

interface Db {
  prepare(q: string): {
    run(...p: unknown[]): unknown;
  };
  close(): void;
}
const requireNode = createRequire(import.meta.url);
const { DatabaseSync } = requireNode("node:sqlite") as {
  DatabaseSync: new (f: string) => Db;
};

let dir = "";

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "xrk-ignorable-"));
});

afterEach(() => {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  } catch {
    /* temp dir */
  }
});

describe("ignorable unknown events", () => {
  it("parse marks ignorable vs required unknowns", () => {
    try {
      parseSessionEvent({
        type: "future/note",
        ts: 1,
        ignorable: true,
      });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(SessionEventParseError);
      expect((error as SessionEventParseError).code).toBe("unknown-ignorable");
    }
    try {
      parseSessionEvent({ type: "future/critical", ts: 1 });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(SessionEventParseError);
      expect((error as SessionEventParseError).code).toBe("unknown-required");
    }
  });

  it("skips ignorable unknown rows and keeps the readable log", () => {
    const seeded = createPersistentSessionStore(dir);
    const id = seeded.create("s").id;
    seeded.flush();
    seeded.close();

    const db = new DatabaseSync(path.join(dir, SESSION_DB_FILENAME));
    const insert = db.prepare(
      "INSERT INTO events (session_id, seq, ts, payload) VALUES (?, ?, ?, ?)",
    );
    insert.run(
      id,
      0,
      1,
      JSON.stringify({ type: "turn/start", ts: 1, turnId: "t1" }),
    );
    insert.run(
      id,
      1,
      2,
      JSON.stringify({ type: "future/note", ts: 2, ignorable: true }),
    );
    insert.run(
      id,
      2,
      3,
      JSON.stringify({
        type: "turn/end",
        ts: 3,
        turnId: "t1",
        reason: { kind: "completed" },
      }),
    );
    db.close();

    const store = createPersistentSessionStore(dir);
    const events = store.readEvents(id);
    expect(events.map((e) => e.type)).toEqual(["turn/start", "turn/end"]);
    store.close();
  });

  it("refuses a required unknown type without fabricating turn/end", () => {
    const seeded = createPersistentSessionStore(dir);
    const id = seeded.create("s").id;
    seeded.append(id, { type: "turn/start", ts: 1, turnId: "t1" });
    seeded.flush();
    seeded.close();

    const db = new DatabaseSync(path.join(dir, SESSION_DB_FILENAME));
    db.prepare(
      "INSERT INTO events (session_id, seq, ts, payload) VALUES (?, ?, ?, ?)",
    ).run(
      id,
      1,
      2,
      JSON.stringify({ type: "future/critical", ts: 2 }),
    );
    db.close();

    const store = createPersistentSessionStore(dir);
    expect(() => store.readEvents(id)).toThrow(SessionLogUnreadableError);
    store.close();
  });
});
