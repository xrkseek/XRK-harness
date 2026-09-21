import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createPersistentSessionStore,
  newSession,
} from "@xrkseek/core-session";
import { dispatchFaceMethod } from "../src/dispatch.js";
import { createFaceListProjectionCache } from "../src/projections/list-checkpoint-cache.js";
import type {
  FaceProjectionRegistry,
  ProjectionCheckpoint,
} from "../src/projections/registry.js";
import {
  createBareFaceRuntime,
  unusedAgentResolve,
} from "./helpers/bare-runtime.js";

describe("session.list cold projection cache", () => {
  it("serves title/metadata from list checkpoint after LRU eviction", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "xrk-face-list-cache-"));
    const cachePath = path.join(dir, "projection-list-cache.json");
    try {
      const store = createPersistentSessionStore(dir, {
        maxResidentSessions: 1,
      });
      const runtime = createBareFaceRuntime({
        store,
        resolveAgent: unusedAgentResolve(),
        listProjectionCachePath: cachePath,
      });

      const cold = newSession(store);
      store.append(cold.id, {
        type: "turn/start",
        ts: 1,
        turnId: "t1",
      });
      store.append(cold.id, {
        type: "user/message",
        ts: 2,
        turnId: "t1",
        content: "hello cold title words",
      });
      store.append(cold.id, {
        type: "turn/end",
        ts: 3,
        turnId: "t1",
        reason: { kind: "completed" },
      });
      // Drive list projections while resident, then force cache write.
      runtime.projections.snapshot(cold.id, {
        keys: ["title", "sessionListMetadata"],
      });
      runtime.listProjectionCache.remember(
        cold.id,
        runtime.projections.checkpoint(cold.id),
      );

      const keeper = newSession(store);
      store.get(keeper.id);
      expect(store.isLoaded?.(cold.id)).toBe(false);

      const list = await dispatchFaceMethod(runtime, "session.list", "list", {});
      expect(list.result.ok).toBe(true);
      if (!list.result.ok) throw new Error("list failed");
      const items = (
        list.result.value as {
          items: {
            sessionId: string;
            blank: boolean;
            title: string | null;
            projections?: { values: Record<string, unknown> };
          }[];
        }
      ).items;
      const row = items.find((r) => r.sessionId === cold.id);
      expect(row).toBeDefined();
      expect(row!.blank).toBe(false);
      expect(row!.projections?.values.sessionListMetadata).toMatchObject({
        blank: false,
      });
      expect(store.isLoaded?.(cold.id)).toBe(false);
      store.close();
    } finally {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* Windows WAL */
      }
    }
  });

  it("treats partial viewCheckpoint omit as miss (no silent wrong cold snap)", () => {
    const cache = createFaceListProjectionCache();
    const checkpoint: ProjectionCheckpoint = {
      title: { ver: 1, seq: 2, val: { title: "kept", pinned: false } },
      sessionListMetadata: {
        ver: 1,
        seq: 2,
        val: { blank: false, preview: "x" },
      },
    };
    cache.remember("s1", checkpoint);

    const registry = {
      viewCheckpoint(cp: ProjectionCheckpoint) {
        // Mimic session-projection: malformed title row omitted, metadata kept.
        const out: Record<string, unknown> = {};
        if (cp.sessionListMetadata !== undefined) {
          out.sessionListMetadata = { blank: false, preview: "x" };
        }
        return out;
      },
    } as Pick<FaceProjectionRegistry, "viewCheckpoint"> as FaceProjectionRegistry;

    expect(cache.cachedSnapshot("s1", registry)).toBeUndefined();
    // Row discarded — second read stays a miss.
    expect(cache.cachedSnapshot("s1", registry)).toBeUndefined();
  });

  it("keeps in-memory cold column when flush I/O fails", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "xrk-face-list-cache-io-"));
    try {
      // Point at a path whose parent is a regular file → mkdir/write fails.
      const blocker = path.join(dir, "not-a-dir");
      writeFileSync(blocker, "x", "utf8");
      const badPath = path.join(blocker, "projection-list-cache.json");
      const cache = createFaceListProjectionCache(badPath);
      const checkpoint: ProjectionCheckpoint = {
        title: { ver: 1, seq: 1, val: { title: "live", pinned: true } },
      };
      expect(() => cache.remember("s1", checkpoint)).not.toThrow();

      const registry = {
        viewCheckpoint(cp: ProjectionCheckpoint) {
          const out: Record<string, unknown> = {};
          if (cp.title !== undefined) out.title = "live";
          return out;
        },
      } as Pick<FaceProjectionRegistry, "viewCheckpoint"> as FaceProjectionRegistry;

      expect(cache.cachedSnapshot("s1", registry)).toEqual({
        asOfSeq: 1,
        values: { title: "live" },
      });
    } finally {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* Windows */
      }
    }
  });
});
