/**
 * Legacy ws_default coding sessions move onto the launch coding workspace.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createMemorySessionStore } from "@xrkseek/core-session";
import { createFaceRuntime } from "../src/runtime.js";
import { dispatchFaceMethod } from "../src/dispatch.js";
import {
  QICHUANG_AGENT_PRESET_ID,
  XIANGYANG_WORKSPACE_ID,
  xiangyangWorkspacePath,
} from "../src/xiangyang-workspace.js";
import { pinSessionAgentPreset } from "../src/session-agent-preset.js";
import { runXiangyangCodingSessionMigrate } from "../src/xiangyang-session-migrate.js";
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

const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) {
    try {
      rmSync(home, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

describe("xiangyang session migrate", () => {
  it("moves non-qichuang sessions off ws_default onto the launch workspace", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "xy-mig-"));
    homes.push(home);
    const launch = path.join(home, "code-proj");
    const runtime = createFaceRuntime({
      store: createMemorySessionStore(),
      drain: drain(),
      workspaceRoot: launch,
      productDir: home,
      resolveAgent: async () => {
        throw new Error("unused");
      },
    });

    const coding = runtime.workspaces
      .list(runtime.store.list())
      .items.find((w) => w.workspaceId !== XIANGYANG_WORKSPACE_ID);
    expect(coding).toBeTruthy();

    // Simulate pre-Xiangyang membership: coding chats stuck on ws_default.
    const legacy = await dispatchFaceMethod(runtime, "session.create", "leg", {
      workspaceId: coding!.workspaceId,
      agentPreset: "harness",
    });
    expect(legacy.result.ok).toBe(true);
    if (!legacy.result.ok) return;
    const legacyId = (legacy.result.value as { sessionId: string }).sessionId;
    runtime.workspaces.attachSession(legacyId, XIANGYANG_WORKSPACE_ID);

    const keep = await dispatchFaceMethod(runtime, "session.create", "qc", {
      workspaceId: XIANGYANG_WORKSPACE_ID,
    });
    expect(keep.result.ok).toBe(true);
    if (!keep.result.ok) return;
    const keepId = (keep.result.value as { sessionId: string }).sessionId;
    pinSessionAgentPreset(runtime, keepId, QICHUANG_AGENT_PRESET_ID);

    const moved = await runXiangyangCodingSessionMigrate(runtime, launch);
    expect(moved).toBeGreaterThanOrEqual(1);
    expect(runtime.workspaces.workspaceIdOf(legacyId)).toBe(coding!.workspaceId);
    expect(runtime.workspaces.workspaceIdOf(keepId)).toBe(XIANGYANG_WORKSPACE_ID);
    expect(path.resolve(runtime.workspaces.get(XIANGYANG_WORKSPACE_ID)!.path)).toBe(
      path.resolve(xiangyangWorkspacePath(home)),
    );
  });
});
