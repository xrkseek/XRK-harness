// R8: cold history suffix without hydrating the full resident log.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createPersistentSessionStore } from "../src/index.js";

let dir = "";
const openStores: Array<{ close(): void }> = [];

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "xrk-events-tail-"));
});

afterEach(() => {
  while (openStores.length > 0) {
    openStores.pop()!.close();
  }
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  } catch {
    /* temp dir */
  }
});

it("readEventsTail returns a cold suffix with absolute baseIndex", () => {
  const store = createPersistentSessionStore(dir);
  openStores.push(store);
  const id = store.create("s").id;
  for (let i = 0; i < 12; i++) {
    store.append(id, {
      type: "turn/start",
      ts: i * 2 + 1,
      turnId: `t${String(i)}`,
    });
    store.append(id, {
      type: "turn/end",
      ts: i * 2 + 2,
      turnId: `t${String(i)}`,
      reason: { kind: "completed" },
    });
  }
  store.flush(id);
  expect(store.releaseResident?.(id)).toBe(true);
  expect(store.isLoaded?.(id)).toBe(false);

  const tail = store.readEventsTail?.(id, 6);
  expect(tail).toBeDefined();
  expect(tail!.events).toHaveLength(6);
  expect(tail!.baseIndex).toBe(18); // 24 total − 6
  expect(tail!.events[0]).toMatchObject({ type: "turn/start", turnId: "t9" });
  expect(store.isLoaded?.(id)).toBe(false);
});

it("scanDurableSingles visits turn/start without installing a resident", () => {
  const store = createPersistentSessionStore(dir);
  openStores.push(store);
  const id = store.create("s").id;
  store.append(id, { type: "turn/start", ts: 1, turnId: "t1" });
  store.append(id, {
    type: "path/allowlisted",
    ts: 2,
    path: "/tmp/xrk-tail-allow",
  });
  store.append(id, {
    type: "turn/end",
    ts: 3,
    turnId: "t1",
    reason: { kind: "completed" },
  });
  store.flush(id);
  expect(store.releaseResident?.(id)).toBe(true);

  const seen: string[] = [];
  store.scanDurableSingles?.(id, (event) => {
    seen.push(event.type);
  });
  expect(seen).toEqual(["turn/start", "path/allowlisted", "turn/end"]);
  expect(store.isLoaded?.(id)).toBe(false);
});
