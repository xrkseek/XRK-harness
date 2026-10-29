// R9: cold history serves heavy projections from durable checkpoint (no hydrate).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createPersistentSessionStore,
  newSession,
} from "@xrkseek/core-session";
import { dispatchFaceMethod } from "../src/dispatch.js";
import { listProjectionIdentityFromHints } from "../src/projections/list-checkpoint-cache.js";
import { sessionHistoryTailProjectionKeys } from "../src/projections/snapshot-keys.js";
import {
  createBareFaceRuntime,
  unusedAgentResolve,
} from "./helpers/bare-runtime.js";

let dir = "";
const openStores: Array<{ close(): void }> = [];

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "xrk-hist-proj-cache-"));
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

describe("session.history projection cache (R9)", () => {
  it("second cold open keeps turnOutline without re-hydrating the log", async () => {
    const store = createPersistentSessionStore(dir);
    openStores.push(store);
    const cachePath = path.join(dir, "projection-list-cache.json");
    const runtime = createBareFaceRuntime({
      store,
      resolveAgent: unusedAgentResolve(),
      listProjectionCachePath: cachePath,
    });
    const session = newSession(store);
    for (let i = 1; i <= 4; i++) {
      const turnId = `t${String(i)}`;
      store.append(session.id, { type: "turn/start", ts: i * 10, turnId });
      store.append(session.id, {
        type: "user/message",
        ts: i * 10 + 1,
        turnId,
        content: `ask ${String(i)}`,
      });
      store.append(session.id, {
        type: "assistant/message",
        ts: i * 10 + 2,
        turnId,
        stepId: `s${String(i)}`,
        content: `reply ${String(i)}`,
      });
      store.append(session.id, {
        type: "turn/end",
        ts: i * 10 + 3,
        turnId,
        reason: { kind: "completed" },
      });
    }
    store.flush?.(session.id);

    // Warm open: fold + remember history-tier checkpoint.
    const warm = await dispatchFaceMethod(runtime, "session.history", "warm", {
      sessionId: session.id,
      maxMessages: 2,
    });
    expect(warm.result.ok).toBe(true);
    if (!warm.result.ok) throw new Error("warm history failed");
    const warmOutline = (
      warm.result.value as {
        projections?: { values: { turnOutline?: unknown } };
      }
    ).projections?.values.turnOutline;
    expect(Array.isArray(warmOutline)).toBe(true);
    expect((warmOutline as unknown[]).length).toBeGreaterThan(0);

    runtime.listProjectionCache.flush();
    expect(store.releaseResident?.(session.id)).toBe(true);
    expect(store.isLoaded?.(session.id)).toBe(false);

    const identity = listProjectionIdentityFromHints(
      store.listHints!(session.id),
    );
    const histCk = runtime.listProjectionCache.peekHistoryCheckpoint(
      session.id,
      identity,
    );
    expect(histCk).toBeDefined();
    expect(Object.keys(histCk ?? {}).sort()).toContain("turnOutline");
    expect(histCk?.turnOutline).toBeDefined();
    const viewed = runtime.projections.viewCheckpoint(histCk!);
    expect(viewed.turnOutline).toEqual(warmOutline);

    // Cold open: R8 tail + R9 history checkpoint — must not install resident.
    const cold = await dispatchFaceMethod(runtime, "session.history", "cold", {
      sessionId: session.id,
      maxMessages: 2,
    });
    expect(cold.result.ok).toBe(true);
    if (!cold.result.ok) throw new Error("cold history failed");
    expect(store.isLoaded?.(session.id)).toBe(false);
    const coldValue = cold.result.value as {
      projections?: { values: Record<string, unknown> };
    };
    expect(coldValue.projections?.values.turnOutline).toEqual(warmOutline);

    // Cache covers the history-tier key set used on the wire.
    const keys = sessionHistoryTailProjectionKeys();
    expect(keys).toContain("turnOutline");
    expect(keys).toContain("contextTimeline");
  });
});
