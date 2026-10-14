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
});
