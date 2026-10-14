import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createMemorySessionStore } from "@xrkseek/core-session";
import { createFaceRuntime } from "../src/runtime.js";
import { dispatchFaceMethod } from "../src/dispatch.js";
import {
  createSessionPostureFragmentProvider,
  formatSessionPosture,
} from "../src/session-posture.js";
import { XIANGYANG_WORKSPACE_ID } from "../src/xiangyang-workspace.js";
import { ensureImWorkspace } from "../src/im-workspace-ensure.js";
import { IM_WORKSPACE_ID } from "../src/im-workspace.js";
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

describe("session_posture", () => {
  it("injects IM / 奇创 role briefs and skips coding badges", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "xrk-posture-"));
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

      const codingRoot = path.join(home, "code-proj");
      const { workspace: codingWs } = runtime.workspaces.create(codingRoot);
      const coding = await dispatchFaceMethod(runtime, "session.create", "c", {
        workspaceId: codingWs.workspaceId,
        agentPreset: "harness",
      });
      expect(coding.result.ok).toBe(true);
      if (!coding.result.ok) return;
      const codingId = (coding.result.value as { sessionId: string }).sessionId;
      expect(formatSessionPosture(runtime, codingId)).toBe("");

      const xy = await dispatchFaceMethod(runtime, "session.create", "xy", {
        workspaceId: XIANGYANG_WORKSPACE_ID,
      });
      expect(xy.result.ok).toBe(true);
      if (!xy.result.ok) return;
      const xyId = (xy.result.value as { sessionId: string }).sessionId;
      const xyText = formatSessionPosture(runtime, xyId);
      expect(xyText).toMatch(/Xiangyang|Qichuang/);
      expect(xyText).toMatch(/full access/);
      expect(xyText).toMatch(/workspace_session_prompt/);

      await ensureImWorkspace(runtime);
      const im = await dispatchFaceMethod(runtime, "session.create", "im", {
        workspaceId: IM_WORKSPACE_ID,
      });
      expect(im.result.ok).toBe(true);
      if (!im.result.ok) return;
      const imId = (im.result.value as { sessionId: string }).sessionId;
      const imText = formatSessionPosture(runtime, imId);
      expect(imText).toMatch(/IM channel/);
      expect(imText).toMatch(/full access/);
      expect(imText).toMatch(/subagent\(workspace_id\)|workspace_session_prompt/);

      const frags = createSessionPostureFragmentProvider(runtime).produce({
        sessionId: imId,
      });
      expect(frags).toHaveLength(1);
      expect(frags[0]!.text).toContain("<session_posture>");
      expect(frags[0]!.priority).toBe(8.5);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
