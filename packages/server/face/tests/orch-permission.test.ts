/**
 * IM / 向阳空间: Settings permission ignored; locked full access.
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createMemorySessionStore, readSessionEvents } from "@xrkseek/core-session";
import { createFaceRuntime } from "../src/runtime.js";
import { dispatchFaceMethod } from "../src/dispatch.js";
import {
  applyLivePermissionDefaultPreset,
  ensureOrchestrationFullAccess,
  permissionSelectFromEvents,
} from "../src/permissions.js";
import { XIANGYANG_WORKSPACE_ID } from "../src/xiangyang-workspace.js";
import { ensureImWorkspace } from "../src/im-workspace-ensure.js";
import { IM_WORKSPACE_ID } from "../src/im-workspace.js";
import { executeFaceCommand } from "../src/slash.js";
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

describe("orchestration permission lock", () => {
  it("pins full access on 向阳 / IM create and refuses /permission switch", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "xrk-orch-perm-"));
    try {
      const runtime = createFaceRuntime({
        store: createMemorySessionStore(),
        workspaceRoot: process.cwd(),
        productDir: home,
        drain: drain(),
        resolveAgent: async () => {
          throw new Error("unused");
        },
      });

      const xy = await dispatchFaceMethod(runtime, "session.create", "xy", {
        workspaceId: XIANGYANG_WORKSPACE_ID,
      });
      expect(xy.result.ok).toBe(true);
      if (!xy.result.ok) return;
      const xyId = (xy.result.value as { sessionId: string }).sessionId;
      expect(
        permissionSelectFromEvents(readSessionEvents(runtime.store, xyId))
          .currentValue,
      ).toBe("danger-full-access");

      await ensureImWorkspace(runtime);
      const im = await dispatchFaceMethod(runtime, "session.create", "im", {
        workspaceId: IM_WORKSPACE_ID,
      });
      expect(im.result.ok).toBe(true);
      if (!im.result.ok) return;
      const imId = (im.result.value as { sessionId: string }).sessionId;
      expect(
        permissionSelectFromEvents(readSessionEvents(runtime.store, imId))
          .currentValue,
      ).toBe("danger-full-access");

      const slash = await executeFaceCommand(
        runtime,
        xyId,
        "/permission read-only",
      );
      expect(slash?.result.kind).toBe("error");
      expect(slash?.result.text).toMatch(/locked to full access/);
      expect(
        permissionSelectFromEvents(readSessionEvents(runtime.store, xyId))
          .currentValue,
      ).toBe("danger-full-access");

      await applyLivePermissionDefaultPreset(
        runtime,
        { defaultPreset: "danger-full-access" },
        { defaultPreset: "read-only" },
      );
      expect(
        permissionSelectFromEvents(readSessionEvents(runtime.store, xyId))
          .currentValue,
      ).toBe("danger-full-access");
      expect(
        permissionSelectFromEvents(readSessionEvents(runtime.store, imId))
          .currentValue,
      ).toBe("danger-full-access");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("upgrades inherited coding knobs when creating under 向阳", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "xrk-orch-inherit-"));
    try {
      const runtime = createFaceRuntime({
        store: createMemorySessionStore(),
        workspaceRoot: process.cwd(),
        productDir: home,
        drain: drain(),
        resolveAgent: async () => {
          throw new Error("unused");
        },
      });

      const coding = runtime.workspaces
        .list(runtime.store.list())
        .items.find((w) => w.workspaceId !== XIANGYANG_WORKSPACE_ID);
      expect(coding).toBeTruthy();
      const parent = await dispatchFaceMethod(runtime, "session.create", "p", {
        workspaceId: coding!.workspaceId,
      });
      expect(parent.result.ok).toBe(true);
      if (!parent.result.ok) return;
      const parentId = (parent.result.value as { sessionId: string }).sessionId;
      expect(
        permissionSelectFromEvents(readSessionEvents(runtime.store, parentId))
          .currentValue,
      ).toBe("workspace-write");

      const child = await dispatchFaceMethod(runtime, "session.create", "c", {
        parentSessionId: parentId,
        workspaceId: XIANGYANG_WORKSPACE_ID,
      });
      expect(child.result.ok).toBe(true);
      if (!child.result.ok) return;
      const childId = (child.result.value as { sessionId: string }).sessionId;
      expect(
        permissionSelectFromEvents(readSessionEvents(runtime.store, childId))
          .currentValue,
      ).toBe("danger-full-access");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("locks full access when a coding session is dragged into 向阳", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "xrk-orch-drag-"));
    try {
      const runtime = createFaceRuntime({
        store: createMemorySessionStore(),
        workspaceRoot: process.cwd(),
        productDir: home,
        drain: drain(),
        resolveAgent: async () => {
          throw new Error("unused");
        },
      });

      const coding = runtime.workspaces
        .list(runtime.store.list())
        .items.find((w) => w.workspaceId !== XIANGYANG_WORKSPACE_ID);
      expect(coding).toBeTruthy();

      const codingSess = await dispatchFaceMethod(runtime, "session.create", "c", {
        workspaceId: coding!.workspaceId,
      });
      expect(codingSess.result.ok).toBe(true);
      if (!codingSess.result.ok) return;
      const codingId = (codingSess.result.value as { sessionId: string })
        .sessionId;

      const xySess = await dispatchFaceMethod(runtime, "session.create", "x", {
        workspaceId: XIANGYANG_WORKSPACE_ID,
      });
      expect(xySess.result.ok).toBe(true);
      if (!xySess.result.ok) return;
      const xyId = (xySess.result.value as { sessionId: string }).sessionId;

      expect(
        permissionSelectFromEvents(readSessionEvents(runtime.store, codingId))
          .currentValue,
      ).toBe("workspace-write");

      const moved = await dispatchFaceMethod(
        runtime,
        "workspace.insertSessionBefore",
        "drag",
        { sessionId: codingId, beforeSessionId: xyId },
      );
      expect(moved.result.ok).toBe(true);
      expect(runtime.workspaces.workspaceIdOf(codingId)).toBe(
        XIANGYANG_WORKSPACE_ID,
      );
      expect(
        permissionSelectFromEvents(readSessionEvents(runtime.store, codingId))
          .currentValue,
      ).toBe("danger-full-access");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("repairs legacy workspace-write pins on orchestration sessions", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "xrk-orch-repair-"));
    try {
      const runtime = createFaceRuntime({
        store: createMemorySessionStore(),
        workspaceRoot: process.cwd(),
        productDir: home,
        drain: drain(),
        resolveAgent: async () => {
          throw new Error("unused");
        },
      });

      const coding = runtime.workspaces
        .list(runtime.store.list())
        .items.find((w) => w.workspaceId !== XIANGYANG_WORKSPACE_ID);
      expect(coding).toBeTruthy();
      const created = await dispatchFaceMethod(runtime, "session.create", "c", {
        workspaceId: coding!.workspaceId,
      });
      expect(created.result.ok).toBe(true);
      if (!created.result.ok) return;
      const sessionId = (created.result.value as { sessionId: string }).sessionId;
      // Simulate a session that landed on 向阳 with Settings workspace-write.
      runtime.workspaces.attachSession(sessionId, XIANGYANG_WORKSPACE_ID);
      expect(
        permissionSelectFromEvents(readSessionEvents(runtime.store, sessionId))
          .currentValue,
      ).toBe("workspace-write");

      const { repairOrchestrationSessionPermissions } = await import(
        "../src/xiangyang-session-migrate.js"
      );
      expect(repairOrchestrationSessionPermissions(runtime)).toBe(1);
      expect(
        permissionSelectFromEvents(readSessionEvents(runtime.store, sessionId))
          .currentValue,
      ).toBe("danger-full-access");
      expect(repairOrchestrationSessionPermissions(runtime)).toBe(0);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  const knobEvents = (
    store: ReturnType<typeof createMemorySessionStore>,
    sessionId: string,
  ): number =>
    readSessionEvents(store, sessionId).filter(
      (event) =>
        event.type === "permission/preset" ||
        event.type === "sandbox/mode" ||
        event.type === "approval/policy",
    ).length;

  it("keeps a fully pinned orchestration session append-free on re-lock", async () => {
    const store = createMemorySessionStore();
    const runtime = createFaceRuntime({
      store,
      workspaceRoot: process.cwd(),
      drain: drain(),
      resolveAgent: async () => {
        throw new Error("unused");
      },
    });
    const created = await dispatchFaceMethod(runtime, "session.create", "c", {
      workspaceId: XIANGYANG_WORKSPACE_ID,
    });
    expect(created.result.ok).toBe(true);
    if (!created.result.ok) return;
    const sessionId = (created.result.value as { sessionId: string }).sessionId;

    const locked = knobEvents(store, sessionId);
    expect(locked).toBeGreaterThan(0);
    expect(
      permissionSelectFromEvents(readSessionEvents(store, sessionId))
        .currentValue,
    ).toBe("danger-full-access");

    // Drag back into 向阳 / migrator retry: already fully locked → no writes.
    ensureOrchestrationFullAccess(store, sessionId, {
      autoGate: runtime.permissionAuto,
    });
    expect(knobEvents(store, sessionId)).toBe(locked);
  });

  /**
   * Regression pin for the fork-seed shape. A UI fork of an orchestration
   * session seeds the parent's log, which can carry the preset identity while
   * sandbox / approval are still inherited from composition defaults. The
   * derived select then reads `custom`, so "am I already full access?" must be
   * answered from the durable preset knob — otherwise every re-lock appends a
   * fresh preset + sandbox + approval trio and the child's log grows on a
   * operation that is supposed to be a no-op.
   */
  it("does not re-append knobs when only the preset identity is pinned", () => {
    const store = createMemorySessionStore();
    const runtime = createFaceRuntime({
      store,
      workspaceRoot: process.cwd(),
      drain: drain(),
      resolveAgent: async () => {
        throw new Error("unused");
      },
    });
    const sessionId = "seed-partial";
    store.create(sessionId);
    store.append(sessionId, {
      type: "permission/preset",
      ts: 1,
      preset: "danger-full-access",
    });

    // Shape check: preset alone derives to `custom`, so an implementation that
    // trusts the derived select would still write here.
    const derived = permissionSelectFromEvents(
      readSessionEvents(store, sessionId),
    ).currentValue;
    expect(derived).not.toBe("danger-full-access");

    ensureOrchestrationFullAccess(store, sessionId, {
      autoGate: runtime.permissionAuto,
    });
    ensureOrchestrationFullAccess(store, sessionId, {
      autoGate: runtime.permissionAuto,
    });

    expect(knobEvents(store, sessionId)).toBe(1);
    expect(
      readSessionEvents(store, sessionId).filter(
        (event) => event.type === "permission/preset",
      ).length,
    ).toBe(1);
  });
});
