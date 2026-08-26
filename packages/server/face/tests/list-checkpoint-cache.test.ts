import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createPersistentSessionStore,
  newSession,
} from "@xrkseek/core-session";
import { dispatchFaceMethod } from "../src/dispatch.js";
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
});
