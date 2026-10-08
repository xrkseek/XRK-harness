import { describe, expect, it, beforeEach } from "vitest";
import { createMemorySessionStore } from "@xrkseek/core-session";
import { buildSessionStatusSnapshot } from "../src/session-status.js";
import {
  clearStatusSnapshotCache,
  resetStatusSnapshotCacheForTests,
  statusSnapshotRevision,
} from "../src/status-snapshot-cache.js";
import { dispatchFaceMethod } from "../src/dispatch.js";
import {
  admittingAgentResolve,
  createBareFaceRuntime,
} from "./helpers/bare-runtime.js";

function bareRuntime(store = createMemorySessionStore()) {
  return createBareFaceRuntime({
    store,
    resolveAgent: admittingAgentResolve(store),
  });
}

describe("status snapshot revision cache", () => {
  beforeEach(() => {
    resetStatusSnapshotCacheForTests();
  });

  it("reuses the same object while the revision fingerprint is unchanged", async () => {
    const runtime = bareRuntime();
    const created = await dispatchFaceMethod(runtime, "session.create", "c", {});
    if (!created.result.ok) throw new Error("create");
    const sessionId = (created.result.value as { sessionId: string }).sessionId;

    const first = buildSessionStatusSnapshot(runtime, sessionId);
    const second = buildSessionStatusSnapshot(runtime, sessionId);
    expect(second).toBe(first);

    const rev = statusSnapshotRevision(runtime, sessionId);
    expect(rev.length).toBeGreaterThan(0);
  });

  it("rebuilds after cache clear (store eviction path)", async () => {
    const runtime = bareRuntime();
    const created = await dispatchFaceMethod(runtime, "session.create", "c2", {});
    if (!created.result.ok) throw new Error("create");
    const sessionId = (created.result.value as { sessionId: string }).sessionId;

    const first = buildSessionStatusSnapshot(runtime, sessionId);
    clearStatusSnapshotCache(sessionId);
    const second = buildSessionStatusSnapshot(runtime, sessionId);
    expect(second).not.toBe(first);
    expect(second.sessionId).toBe(first.sessionId);
  });
});
