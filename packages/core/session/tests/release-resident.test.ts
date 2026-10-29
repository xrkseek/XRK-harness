// Cold observation must drop idle residents without touching open turns.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createPersistentSessionStore } from "../src/index.js";

let dir = "";

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "xrk-release-resident-"));
});

afterEach(() => {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  } catch {
    /* temp dir */
  }
});

it("releases an idle session after hydrate, and refuses while a turn is open", () => {
  const store = createPersistentSessionStore(dir);
  const id = store.create("s").id;
  store.append(id, { type: "turn/start", ts: 1, turnId: "t1" });
  store.flush(id);

  expect(store.isLoaded?.(id)).toBe(true);
  expect(store.releaseResident(id)).toBe(false);
  expect(store.isLoaded?.(id)).toBe(true);

  store.append(id, {
    type: "turn/end",
    ts: 2,
    turnId: "t1",
    reason: { kind: "completed" },
  });
  store.flush(id);

  expect(store.releaseResident(id)).toBe(true);
  expect(store.isLoaded?.(id)).toBe(false);

  // Re-hydrate still works from disk.
  expect(store.get(id).events).toHaveLength(2);
  store.close();
});
