// R7 fast path must SET event_count (not ADD onto the pre-cut value).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createPersistentSessionStore } from "../src/index.js";

let dir = "";
const openStores: Array<{ close(): void }> = [];

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "xrk-r7-hints-"));
});

afterEach(() => {
  while (openStores.length > 0) {
    openStores.pop()!.close();
  }
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  } catch {
    /* temp */
  }
});

it("replacePrefix tail cut keeps listHints.eventCount === logical length", () => {
  const store = createPersistentSessionStore(dir);
  openStores.push(store);
  const id = store.create("s").id;
  for (let i = 0; i < 20; i++) {
    store.append(id, { type: "turn/start", ts: i * 2 + 1, turnId: `t${i}` });
    store.append(id, {
      type: "turn/end",
      ts: i * 2 + 2,
      turnId: `t${i}`,
      reason: { kind: "completed" },
    });
  }
  store.flush(id);
  expect(store.listHints(id).eventCount).toBe(40);

  const kept = store.readEvents(id).slice(0, 30);
  store.replacePrefix!(id, kept);
  expect(store.readEvents(id)).toHaveLength(30);
  expect(store.listHints(id).eventCount).toBe(30);

  store.releaseResident?.(id);
  expect(store.listHints(id).eventCount).toBe(30);
  const tail = store.readEventsTail?.(id, 10);
  expect(tail?.baseIndex).toBe(20);
  expect(tail?.events).toHaveLength(10);
});
