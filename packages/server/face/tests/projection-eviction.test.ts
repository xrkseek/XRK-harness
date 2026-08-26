import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createPersistentSessionStore,
  newSession,
} from "@xrkseek/core-session";
import {
  createBareFaceRuntime,
  unusedAgentResolve,
} from "./helpers/bare-runtime.js";

describe("projection LRU eviction (Codex tier)", () => {
  it("store eviction clears in-memory projection cells", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "xrk-face-proj-evict-"));
    try {
      const store = createPersistentSessionStore(dir, {
        maxResidentSessions: 1,
      });
      const runtime = createBareFaceRuntime({
        store,
        resolveAgent: unusedAgentResolve(),
      });

      const evicted = newSession(store);
      store.append(evicted.id, {
        type: "turn/start",
        ts: 1,
        turnId: "t1",
      });
      store.append(evicted.id, {
        type: "user/message",
        ts: 2,
        turnId: "t1",
        content: "before eviction",
      });
      const before = runtime.projections.snapshot(evicted.id, {
        keys: ["sessionListMetadata"],
      });
      expect(before.values.sessionListMetadata?.blank).toBe(false);

      const keeper = newSession(store);
      store.get(keeper.id);

      expect(store.isLoaded?.(evicted.id)).toBe(false);

      store.get(evicted.id);
      const after = runtime.projections.snapshot(evicted.id, {
        keys: ["sessionListMetadata"],
      });
      expect(after.values.sessionListMetadata?.blank).toBe(false);
      expect(after.asOfSeq).toBeGreaterThan(0);
      store.close();
    } finally {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* Windows may keep WAL handles briefly after close */
      }
    }
  });
});
