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

  it("busts cache when session opener or humanSpoke flips", async () => {
    const runtime = bareRuntime();
    const created = await dispatchFaceMethod(runtime, "session.create", "c-opener", {});
    if (!created.result.ok) throw new Error("create");
    const sessionId = (created.result.value as { sessionId: string }).sessionId;

    const before = buildSessionStatusSnapshot(runtime, sessionId);
    const revBefore = statusSnapshotRevision(runtime, sessionId);

    const openerCreated = await dispatchFaceMethod(
      runtime,
      "session.create",
      "c-opener-src",
      {},
    );
    if (!openerCreated.result.ok) throw new Error("create opener src");
    const openerSourceId = (openerCreated.result.value as { sessionId: string })
      .sessionId;
    runtime.sessionOpeners.set(sessionId, {
      memberId: "mem_seed_manager",
      sourceSessionId: openerSourceId,
    });
    const revOpener = statusSnapshotRevision(runtime, sessionId);
    expect(revOpener).not.toBe(revBefore);
    const afterOpener = buildSessionStatusSnapshot(runtime, sessionId);
    expect(afterOpener).not.toBe(before);
    // Paint follows the source session individual (look/member), not the
    // opener record's memberId alone — bare create lands on 向日葵.
    expect(afterOpener.delegate?.parentSessionId).toBe(openerSourceId);
    expect(afterOpener.delegate?.parentMemberId).toBeTruthy();

    runtime.sessionHumanSpoke.add(sessionId);
    const revSpoke = statusSnapshotRevision(runtime, sessionId);
    expect(revSpoke).not.toBe(revOpener);
    const afterSpoke = buildSessionStatusSnapshot(runtime, sessionId);
    expect(afterSpoke).not.toBe(afterOpener);
    expect(afterSpoke.delegate?.parents?.at(-1)?.sessionId).toBe(`${sessionId}:boss`);
  });

  it("busts cache when opener source session presence changes", async () => {
    const runtime = bareRuntime();
    const src = await dispatchFaceMethod(runtime, "session.create", "src-pres", {});
    const child = await dispatchFaceMethod(runtime, "session.create", "child-pres", {});
    if (!src.result.ok || !child.result.ok) throw new Error("create");
    const sourceId = (src.result.value as { sessionId: string }).sessionId;
    const sessionId = (child.result.value as { sessionId: string }).sessionId;
    runtime.sessionOpeners.set(sessionId, {
      memberId: "mem_seed_manager",
      sourceSessionId: sourceId,
    });

    const before = buildSessionStatusSnapshot(runtime, sessionId);
    const revBefore = statusSnapshotRevision(runtime, sessionId);
    expect(before.parentPresence).toBeUndefined();

    runtime.presence.set(sourceId, {
      emotionId: "31",
      tips: "source ball moved",
    });
    const revAfter = statusSnapshotRevision(runtime, sessionId);
    expect(revAfter).not.toBe(revBefore);
    const after = buildSessionStatusSnapshot(runtime, sessionId);
    expect(after).not.toBe(before);
    expect(after.parentPresence).toMatchObject({
      emotionId: "31",
      tips: "source ball moved",
    });
    expect(after.delegate?.parents?.[0]?.presence).toMatchObject({
      emotionId: "31",
      tips: "source ball moved",
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
