import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createPersistentSessionStore,
  SESSION_DB_FILENAME,
} from "../src/index.js";
import type { SessionEvent } from "@xrkseek/protocol";

const dirs: string[] = [];
const openStores: Array<{ close(): void }> = [];

afterEach(() => {
  while (openStores.length > 0) openStores.pop()!.close();
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "xrk-wal-"));
  dirs.push(dir);
  return dir;
}

function track<T extends { close(): void }>(store: T): T {
  openStores.push(store);
  return store;
}

function walBytes(dir: string): number {
  const file = path.join(dir, `${SESSION_DB_FILENAME}-wal`);
  return existsSync(file) ? statSync(file).size : 0;
}

function chunk(ts: number, text: string): SessionEvent {
  return {
    type: "assistant/chunk",
    ts,
    turnId: "t1",
    stepId: "s1",
    text,
    kind: "text",
    index: 1,
  };
}

/** Enough payload that the WAL comfortably exceeds a lowered threshold. */
function fill(store: ReturnType<typeof createPersistentSessionStore>, sessionId: string): void {
  const text = "x".repeat(2048);
  for (let i = 0; i < 200; i += 1) store.append(sessionId, chunk(i, text));
}

describe("WAL reclaim while the store stays open", () => {
  it("truncates an oversized WAL on flush instead of keeping the historical peak", () => {
    const dir = tempDir();
    const store = track(
      createPersistentSessionStore(dir, { walShrinkMinBytes: 64 * 1024, walShrinkIntervalMs: 0 }),
    );
    const session = store.create("sess-wal");
    fill(store, session.id);
    store.flush();

    // Same workload as the next case, which keeps ~1.5 MB of WAL: this store
    // reclaims it because the shrink threshold is lowered and not rate-limited.
    // TRUNCATE (not PASSIVE) is the only checkpoint that gives the file back.
    expect(walBytes(dir)).toBe(0);
    // The frames were copied into the database first, so nothing is lost.
    expect(store.get("sess-wal").events).toHaveLength(200);
  });

  it("leaves a WAL below the threshold alone", () => {
    const dir = tempDir();
    const store = track(createPersistentSessionStore(dir));
    const session = store.create("sess-small");
    fill(store, session.id);

    store.flush();

    // Default threshold is 64 MiB, so a ~1.5 MB WAL must not be truncated.
    expect(walBytes(dir)).toBeGreaterThan(1024 * 1024);
  });

  it("survives a reopen after the shrink", () => {
    const dir = tempDir();
    const first = track(
      createPersistentSessionStore(dir, { walShrinkMinBytes: 64 * 1024, walShrinkIntervalMs: 0 }),
    );
    const session = first.create("sess-reopen");
    fill(first, session.id);
    first.flush();
    first.close();
    openStores.pop();

    const second = track(createPersistentSessionStore(dir));
    expect(second.get("sess-reopen").events).toHaveLength(200);
  });
});

