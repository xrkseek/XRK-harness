import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createPersistentSessionStore,
  newSession,
} from "@xrkseek/core-session";
import { dispatchFaceMethod } from "../src/dispatch.js";
import {
  createFaceListProjectionCache,
  listProjectionIdentityFromHints,
  LIST_PROJECTION_IDENTITY_VERSION,
  lowestCheckpointSeq,
  type ListProjectionIdentity,
} from "../src/projections/list-checkpoint-cache.js";
import { installDefaultFaceProjections } from "../src/projections/install-defaults.js";
import {
  createFaceProjectionRegistry,
  type FaceProjectionRegistry,
  type ProjectionCheckpoint,
} from "../src/projections/registry.js";
import { SESSION_LIST_PROJECTION_KEYS } from "../src/projections/snapshot-keys.js";
import {
  createBareFaceRuntime,
  unusedAgentResolve,
} from "./helpers/bare-runtime.js";

const idA: ListProjectionIdentity = {
  formatVersion: LIST_PROJECTION_IDENTITY_VERSION,
  eventCount: 3,
  lastEventTs: 3,
};

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
        runtime.projections.checkpoint(cold.id, {
          keys: ["title", "sessionListMetadata"],
        }),
        listProjectionIdentityFromHints(store.listHints!(cold.id)),
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
    cache.remember("s1", checkpoint, idA);

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

    expect(cache.cachedSnapshot("s1", registry, idA)).toBeUndefined();
    // Row discarded — second read stays a miss.
    expect(cache.cachedSnapshot("s1", registry, idA)).toBeUndefined();
  });

  it("remembers list checkpoint on turn/end without an explicit remember()", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "xrk-face-turn-end-cache-"));
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
      // Patched append drives projections and must checkpoint on turn/end.
      store.append(cold.id, { type: "turn/start", ts: 1, turnId: "t1" });
      store.append(cold.id, {
        type: "user/message",
        ts: 2,
        turnId: "t1",
        content: "auto title from turn end",
      });
      store.append(cold.id, {
        type: "turn/end",
        ts: 3,
        turnId: "t1",
        reason: { kind: "completed" },
      });

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
            projections?: { values: Record<string, unknown> };
          }[];
        }
      ).items;
      const row = items.find((r) => r.sessionId === cold.id);
      expect(row?.blank).toBe(false);
      expect(row?.projections?.values.sessionListMetadata).toMatchObject({
        blank: false,
      });
      store.close();
    } finally {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* Windows WAL */
      }
    }
  });

  it("default Face units declare the documented list summary keys", () => {
    const registry = createFaceProjectionRegistry({
      getEvents: () => [],
    });
    installDefaultFaceProjections(registry);
    expect([...registry.summaryKeys()].sort()).toEqual(
      [...SESSION_LIST_PROJECTION_KEYS].sort(),
    );
  });

  it("peekCheckpoint returns raw rows only when identity matches", () => {
    const cache = createFaceListProjectionCache();
    const checkpoint: ProjectionCheckpoint = {
      title: { ver: 1, seq: 1, val: { title: "t", pinned: false } },
    };
    cache.remember("s1", checkpoint, idA);
    expect(cache.peekCheckpoint("s1", idA)?.title?.val).toEqual({
      title: "t",
      pinned: false,
    });
    expect(
      cache.peekCheckpoint("s1", { ...idA, eventCount: 99 }),
    ).toBeUndefined();
  });

  it("misses when lifecycle identity does not match", () => {
    const cache = createFaceListProjectionCache();
    cache.remember(
      "s1",
      { title: { ver: 1, seq: 1, val: { title: "old", pinned: false } } },
      idA,
    );
    const registry = {
      viewCheckpoint: () => ({ title: "old" }),
    } as unknown as FaceProjectionRegistry;

    expect(
      cache.cachedSnapshot("s1", registry, {
        ...idA,
        eventCount: 0,
        lastEventTs: null,
      }),
    ).toBeUndefined();
    // Lifecycle mismatch discards the row.
    expect(cache.cachedSnapshot("s1", registry, idA)).toBeUndefined();
  });

  it("serves predecessor title after list-identity format bump", () => {
    const cache = createFaceListProjectionCache();
    cache.remember(
      "s1",
      {
        title: { ver: 1, seq: 4, val: { title: "kept", pinned: false } },
        sessionListMetadata: {
          ver: 1,
          seq: 4,
          val: { blank: false, lastPromptAt: 2 },
        },
      },
      idA,
    );
    const registry = {
      viewCheckpoint(cp: ProjectionCheckpoint) {
        const out: Record<string, unknown> = {};
        if (cp.title !== undefined) out.title = "kept";
        if (cp.sessionListMetadata !== undefined) {
          out.sessionListMetadata = { blank: false, lastPromptAt: 2 };
        }
        return out;
      },
    } as unknown as FaceProjectionRegistry;

    const bumped: ListProjectionIdentity = {
      ...idA,
      formatVersion: idA.formatVersion + 1,
    };
    // Exact-identity path misses but keeps the row for a title hint.
    expect(cache.cachedSnapshot("s1", registry, bumped)).toBeUndefined();
    expect(cache.cachedPredecessorTitle("s1", registry, bumped)).toEqual({
      asOfSeq: 4,
      values: { title: "kept" },
    });
    // Hydration seed still requires the current format.
    expect(cache.peekCheckpoint("s1", bumped)).toBeUndefined();
    expect(cache.peekCheckpoint("s1", idA)?.title).toBeDefined();
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
      expect(() => cache.remember("s1", checkpoint, idA)).not.toThrow();

      const registry = {
        viewCheckpoint(cp: ProjectionCheckpoint) {
          const out: Record<string, unknown> = {};
          if (cp.title !== undefined) out.title = "live";
          return out;
        },
      } as Pick<FaceProjectionRegistry, "viewCheckpoint"> as FaceProjectionRegistry;

      expect(cache.cachedSnapshot("s1", registry, idA)).toEqual({
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

  // The client seeds its incremental baseline from `asOfSeq` and drops rows at
  // or below it. Reporting the highest row seq claims the whole map is as fresh
  // as its freshest key, and the rows that would have advanced the lagging key
  // are then silently skipped.
  describe("watermark", () => {
    it("is the lowest row seq, not the highest", () => {
      expect(lowestCheckpointSeq({})).toBe(-1);
      expect(
        lowestCheckpointSeq({
          title: { ver: 1, seq: 7, val: "T" },
          sessionListMetadata: { ver: 1, seq: 3, val: {} },
        }),
      ).toBe(3);
    });

    it("surfaces that watermark through cachedSnapshot", () => {
      const cache = createFaceListProjectionCache();
      cache.remember(
        "s1",
        {
          title: { ver: 1, seq: 7, val: "T" },
          sessionListMetadata: { ver: 1, seq: 3, val: {} },
        },
        idA,
      );
      const registry = {
        viewCheckpoint: () => ({ title: "T", sessionListMetadata: {} }),
      } as unknown as FaceProjectionRegistry;

      expect(cache.cachedSnapshot("s1", registry, idA)?.asOfSeq).toBe(3);
    });
  });
});
