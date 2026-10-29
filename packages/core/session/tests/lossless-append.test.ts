import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createMemorySessionStore, createPersistentSessionStore } from "../src/index.js";

let dir = "";

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "xrk-lossless-"));
});

afterEach(() => {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  } catch {
    /* temp */
  }
});

it("rejects non-JSON values at append before they reach the log", () => {
  const store = createMemorySessionStore();
  const id = store.create("s").id;
  expect(() =>
    store.append(id, {
      type: "turn/end",
      ts: 1,
      turnId: "t1",
      // `error` is opaque on the wire — Map must fail at append, not at flush.
      reason: { kind: "error", error: new Map([["k", 1]]) },
    }),
  ).toThrow(/losslessly JSON-serializable/);
  expect(store.readEvents(id)).toHaveLength(0);
});

it("persistent store refuses the same poison without writing rows", () => {
  const store = createPersistentSessionStore(dir);
  const id = store.create("s").id;
  expect(() =>
    store.append(id, {
      type: "turn/end",
      ts: 1,
      turnId: "t1",
      reason: { kind: "error", error: new Date(0) },
    }),
  ).toThrow(/losslessly JSON-serializable/);
  store.flush();
  expect(store.get(id).events).toHaveLength(0);
  store.close();
});
