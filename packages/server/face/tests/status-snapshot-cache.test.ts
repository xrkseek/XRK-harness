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

  it("busts cache when Boss outfit fields change in ui-presence", async () => {
    const runtime = bareRuntime();
    const created = await dispatchFaceMethod(runtime, "session.create", "c3", {});
    if (!created.result.ok) throw new Error("create");
    const sessionId = (created.result.value as { sessionId: string }).sessionId;

    const before = buildSessionStatusSnapshot(runtime, sessionId);
    const revBefore = statusSnapshotRevision(runtime, sessionId);

    Object.assign(runtime.settingsNamespaces.ensure("ui-presence").user, {
      shape: "wedge",
      color: "sage",
      kitHat: "bow",
      kitGlasses: "specs",
      kitHeld: "tea",
    });

    const revAfter = statusSnapshotRevision(runtime, sessionId);
    expect(revAfter).not.toBe(revBefore);

    const after = buildSessionStatusSnapshot(runtime, sessionId);
    expect(after).not.toBe(before);
    expect(after.parentCompanionBall).toMatchObject({
      shape: "wedge",
      color: "sage",
      kitHat: "bow",
      kitGlasses: "specs",
      kitHeld: "tea",
    });
  });

  it("busts cache when seat titleScheme / title* change", async () => {
    const runtime = bareRuntime();
    const coding = runtime.workspaces.create(`${runtime.workspaceRoot}/code-titles`);
    const created = await dispatchFaceMethod(runtime, "session.create", "c-titles", {
      workspaceId: coding.workspace.workspaceId,
    });
    if (!created.result.ok) throw new Error("create");
    const sessionId = (created.result.value as { sessionId: string }).sessionId;

    Object.assign(runtime.settingsNamespaces.ensure("locale").user, {
      preference: "zh",
    });
    Object.assign(runtime.settingsNamespaces.ensure("ui-presence").user, {
      titleScheme: "office",
      titleBoss: "",
      titleManager: "",
      titleAgent: "",
    });
    const before = buildSessionStatusSnapshot(runtime, sessionId);
    const revBefore = statusSnapshotRevision(runtime, sessionId);
    expect(before.delegate?.childLabel ?? "").toMatch(/经理/);

    Object.assign(runtime.settingsNamespaces.ensure("ui-presence").user, {
      titleScheme: "guild",
    });
    const revAfter = statusSnapshotRevision(runtime, sessionId);
    expect(revAfter).not.toBe(revBefore);
    const after = buildSessionStatusSnapshot(runtime, sessionId);
    expect(after.delegate?.childLabel ?? "").toMatch(/干部/);
  });
});
