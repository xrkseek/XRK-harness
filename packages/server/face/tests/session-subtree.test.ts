import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createMemorySessionStore } from "@xrkseek/core-session";
import { createFaceRuntime } from "../src/runtime.js";
import { dispatchFaceMethod } from "../src/dispatch.js";
import {
  collectDelegatedDescendants,
  ensureSessionHotWritable,
  pruneExcessBlankSessions,
  pruneOrphanDelegatedSessions,
  repairSessionStoreOnBoot,
  wipeDurableSession,
} from "../src/session-subtree.js";
import type { FaceDrain } from "../src/context.js";

function drain(): FaceDrain {
  return {
    wake() {},
    async cancel() {},
    isActive() {
      return false;
    },
  };
}

async function freshRuntime() {
  const root = await mkdtemp(path.join(tmpdir(), "xrk-face-subtree-"));
  const store = createMemorySessionStore();
  const runtime = createFaceRuntime({
    store,
    workspaceRoot: root,
    productDir: path.join(root, ".xrk"),
    drain: drain(),
    resolveAgent: async () => {
      throw new Error("unused");
    },
  });
  return { root, store, runtime };
}

async function createSession(
  runtime: ReturnType<typeof createFaceRuntime>,
  payload: Record<string, unknown> = {},
): Promise<string> {
  const res = await dispatchFaceMethod(runtime, "session.create", "c", payload);
  expect(res.result.ok).toBe(true);
  if (!res.result.ok) throw new Error("create failed");
  return (res.result.value as { sessionId: string }).sessionId;
}

describe("session subtree lifecycle", () => {
  it("archive parent archives+keeps delegated children; delete parent wipes them", async () => {
    const { store, runtime } = await freshRuntime();
    const parentId = await createSession(runtime);
    const childId = await createSession(runtime, {
      parentSessionId: parentId,
      mode: "continuable",
      label: "调研员",
    });
    const forkId = await createSession(runtime, {
      parentSessionId: parentId,
      mode: "fork",
      label: "fork",
    });
    // session.create with mode fork may still attach as continuable — force fork link.
    runtime.subagents.detach(forkId);
    runtime.subagents.attach({
      parentSessionId: parentId,
      childSessionId: forkId,
      mode: "fork",
      label: "fork",
    });

    expect(collectDelegatedDescendants(runtime, parentId)).toEqual([childId]);
    expect(store.has(childId)).toBe(true);
    expect(store.has(forkId)).toBe(true);

    const archived = await dispatchFaceMethod(
      runtime,
      "workspace.archiveSession",
      "a1",
      { sessionId: parentId },
    );
    expect(archived.result.ok).toBe(true);
    expect(runtime.workspaces.isArchived(parentId)).toBe(true);
    expect(runtime.workspaces.isArchived(childId)).toBe(true);
    // Fork stays an independent sidebar session.
    expect(runtime.workspaces.isArchived(forkId)).toBe(false);
    expect(store.has(forkId)).toBe(true);

    const deleted = await dispatchFaceMethod(runtime, "session.delete", "d1", {
      sessionId: parentId,
    });
    expect(deleted.result.ok).toBe(true);
    expect(store.has(parentId)).toBe(false);
    expect(store.has(childId)).toBe(false);
    expect(runtime.subagents.getByChild(childId)).toBeUndefined();
    // Fork survives parent wipe.
    expect(store.has(forkId)).toBe(true);
  });

  it("boot prune wipes delegated children whose parent is already gone", async () => {
    const { store, runtime } = await freshRuntime();
    const parentId = await createSession(runtime);
    const childId = await createSession(runtime, {
      parentSessionId: parentId,
      mode: "continuable",
      label: "施工员",
    });

    // Simulate the historical hole: parent deleted without cascade.
    store.delete?.(parentId);
    runtime.workspaces.forgetSession(parentId);
    expect(store.has(parentId)).toBe(false);
    expect(store.has(childId)).toBe(true);
    expect(runtime.subagents.getByChild(childId)?.parentSessionId).toBe(parentId);

    const wiped = await pruneOrphanDelegatedSessions(runtime);
    expect(wiped).toBeGreaterThanOrEqual(1);
    expect(store.has(childId)).toBe(false);
    expect(runtime.subagents.getByChild(childId)).toBeUndefined();
  });

  it("boot prune wipes nested delegated grandchildren in one pass", async () => {
    const { store, runtime } = await freshRuntime();
    const parentId = await createSession(runtime);
    const childId = await createSession(runtime, {
      parentSessionId: parentId,
      mode: "continuable",
      label: "班长",
    });
    const grandId = await createSession(runtime, {
      parentSessionId: childId,
      mode: "one-shot",
      label: "工人",
    });

    store.delete?.(parentId);
    runtime.workspaces.forgetSession(parentId);
    // Only the direct child looks like an orphan; grandchild still has childId.
    expect(runtime.store.has(childId)).toBe(true);
    expect(runtime.store.has(grandId)).toBe(true);

    const wiped = await pruneOrphanDelegatedSessions(runtime, { reclaim: false });
    expect(wiped).toBeGreaterThanOrEqual(2);
    expect(store.has(childId)).toBe(false);
    expect(store.has(grandId)).toBe(false);
    expect(runtime.subagents.getByChild(childId)).toBeUndefined();
    expect(runtime.subagents.getByChild(grandId)).toBeUndefined();
  });

  it("repairSessionStoreOnBoot chains orphan then blank prune", async () => {
    const { store, runtime } = await freshRuntime();
    const workspaceId = runtime.workspaces.list(store.list()).items[0]
      ?.workspaceId!;
    const cwd = runtime.workspaces.get(workspaceId)!.path;
    const parentId = await createSession(runtime, { workspaceId });
    const childId = await createSession(runtime, {
      parentSessionId: parentId,
      mode: "continuable",
      label: "幽灵",
    });
    store.delete?.(parentId);
    runtime.workspaces.forgetSession(parentId);

    const a = store.create().id;
    const b = store.create().id;
    runtime.workspaces.attachSession(a, workspaceId);
    runtime.workspaces.attachSession(b, workspaceId);
    runtime.sessionCwds.set(a, cwd);
    runtime.sessionCwds.set(b, cwd);

    const stats = await repairSessionStoreOnBoot(runtime);
    expect(stats.orphansWiped).toBeGreaterThanOrEqual(1);
    expect(store.has(childId)).toBe(false);
    // Excess blanks capped to one keeper.
    const blanksLeft = [a, b].filter((id) => store.has(id)).length;
    expect(blanksLeft).toBeLessThanOrEqual(1);
  });

  it("pruneExcessBlankSessions keeps one blank per workspace and drops orphans", async () => {
    const { store, runtime } = await freshRuntime();
    const listed = runtime.workspaces.list(store.list());
    const workspaceId = listed.items[0]?.workspaceId;
    expect(workspaceId).toBeTruthy();
    const cwd = runtime.workspaces.get(workspaceId!)!.path;

    // Mint blanks under the registry without session.create (which already
    // prunes siblings) so the keeper selection is under test.
    const mintBlank = () => {
      const id = store.create().id;
      runtime.workspaces.attachSession(id, workspaceId!);
      runtime.sessionCwds.set(id, cwd);
      return id;
    };
    const a = mintBlank();
    const b = mintBlank();
    const c = mintBlank();
    expect(store.has(a)).toBe(true);
    expect(store.has(b)).toBe(true);
    expect(store.has(c)).toBe(true);

    const wiped = await pruneExcessBlankSessions(runtime, {
      keepSessionId: c,
      workspaceId,
    });
    expect(wiped).toBe(2);
    expect(store.has(a)).toBe(false);
    expect(store.has(b)).toBe(false);
    expect(store.has(c)).toBe(true);

    // Membership-less blank is wiped on a full scan.
    const stray = store.create().id;
    runtime.sessionCwds.set(stray, cwd);
    expect(runtime.workspaces.workspaceIdOf(stray)).toBeUndefined();
    const wipedStray = await pruneExcessBlankSessions(runtime);
    expect(wipedStray).toBeGreaterThanOrEqual(1);
    expect(store.has(stray)).toBe(false);
  });

  it("session.create prunes sibling blanks only when inheritFrom is a live chat", async () => {
    const { store, runtime } = await freshRuntime();
    const workspaceId = runtime.workspaces.list(store.list()).items[0]
      ?.workspaceId;
    expect(workspaceId).toBeTruthy();
    // Plain creates must keep sibling blanks (fixtures / multi-blank).
    const old = await createSession(runtime, { workspaceId });
    const plain = await createSession(runtime, { workspaceId });
    expect(store.has(old)).toBe(true);
    expect(store.has(plain)).toBe(true);
    // Live inherit (non-blank source) is the Hero skip-reuse path — prune.
    store.append(plain, {
      type: "turn/start",
      ts: Date.now(),
      turnId: "t1",
    } as never);
    const newer = await createSession(runtime, {
      workspaceId,
      inheritFrom: plain,
    });
    expect(store.has(old)).toBe(false);
    expect(store.has(plain)).toBe(true);
    expect(store.has(newer)).toBe(true);
  });

  it("partial store.delete after attach leaves membership; wipe clears it", async () => {
    const { store, runtime } = await freshRuntime();
    const workspaceId = runtime.workspaces.list(store.list()).items[0]
      ?.workspaceId!;
    const id = await createSession(runtime, { workspaceId });
    expect(runtime.workspaces.workspaceIdOf(id)).toBe(workspaceId);
    // Historical create-fail hole: delete the log, leave registry rows.
    store.delete?.(id);
    expect(store.has(id)).toBe(false);
    expect(runtime.workspaces.workspaceIdOf(id)).toBe(workspaceId);
    await wipeDurableSession(runtime, id);
    expect(runtime.workspaces.workspaceIdOf(id)).toBeUndefined();
  });

  it("ensureSessionHotWritable restores archived registry before writes", async () => {
    const { runtime } = await freshRuntime();
    const sessionId = await createSession(runtime);
    const archived = await dispatchFaceMethod(
      runtime,
      "workspace.archiveSession",
      "arch",
      { sessionId },
    );
    expect(archived.result.ok).toBe(true);
    expect(runtime.workspaces.isArchived(sessionId)).toBe(true);
    const restored = await ensureSessionHotWritable(runtime, sessionId);
    expect(restored).toBe(true);
    expect(runtime.workspaces.isArchived(sessionId)).toBe(false);
  });

  it("pinSession restores delegated children that followed the parent into archive", async () => {
    const { runtime } = await freshRuntime();
    const parentId = await createSession(runtime);
    const childId = await createSession(runtime, {
      parentSessionId: parentId,
      mode: "continuable",
      label: "调研员",
    });
    const archived = await dispatchFaceMethod(
      runtime,
      "workspace.archiveSession",
      "arch-pin",
      { sessionId: parentId },
    );
    expect(archived.result.ok).toBe(true);
    expect(runtime.workspaces.isArchived(parentId)).toBe(true);
    expect(runtime.workspaces.isArchived(childId)).toBe(true);

    const pinned = await dispatchFaceMethod(
      runtime,
      "workspace.pinSession",
      "pin1",
      { sessionId: parentId },
    );
    expect(pinned.result.ok).toBe(true);
    expect(runtime.workspaces.isArchived(parentId)).toBe(false);
    expect(runtime.workspaces.isArchived(childId)).toBe(false);
  });
});
