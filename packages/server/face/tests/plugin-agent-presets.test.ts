import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  compositionRowsForProfile,
  listFaceAgentPresetGroups,
} from "../src/plugin-agent-presets.js";
import { FACE_AGENT_PRESETS } from "../src/presets-catalog.js";
import { createFaceRuntime } from "../src/runtime.js";
import { createMemorySessionStore } from "@xrkseek/core-session";

describe("plugin agentPresets composition inventory", () => {
  it("maps badge tool flags into composition:* rows", () => {
    const minimal = FACE_AGENT_PRESETS.find((p) => p.id === "minimal")!;
    const rows = compositionRowsForProfile(minimal.profile);
    expect(rows.find((r) => r.moduleName === "composition:base")?.enabled).toBe(true);
    expect(rows.find((r) => r.moduleName === "composition:harness-tools")?.enabled).toBe(false);
    expect(rows.find((r) => r.moduleName === "composition:web")?.enabled).toBe(false);
    expect(rows.find((r) => r.moduleName === "composition:subagents")?.enabled).toBe(false);

    const shallow = FACE_AGENT_PRESETS.find((p) => p.id === "shallow")!;
    const shallowRows = compositionRowsForProfile(shallow.profile);
    expect(shallowRows.find((r) => r.moduleName === "composition:web")?.enabled).toBe(true);
    // shallow enables subagents with a depth condition
    const sub = shallowRows.find((r) => r.moduleName === "composition:subagents");
    expect(sub?.enabled).toBe("conditional");
    expect(sub?.condition).toBe("maxDepth<=1");
  });

  it("lists every catalog badge and marks the Face default", () => {
    const store = createMemorySessionStore();
    // Empty productDir so ~/.xrk/settings.yaml cannot override defaultAgentPreset.
    const productDir = mkdtempSync(path.join(tmpdir(), "xrk-face-presets-"));
    const runtime = createFaceRuntime({
      store,
      resolveAgent: async () => {
        throw new Error("unused");
      },
      drain: { abort: () => undefined, isRunning: () => false },
      workspaceRoot: process.cwd(),
      productDir,
      defaultAgentPreset: "frugal",
      skipDefaultProjections: true,
    });
    const groups = listFaceAgentPresetGroups(runtime);
    expect(groups.map((g) => g.id)).toEqual(FACE_AGENT_PRESETS.map((p) => p.id));
    expect(groups.find((g) => g.id === "frugal")?.isDefault).toBe(true);
    expect(groups.filter((g) => g.isDefault)).toHaveLength(1);
    expect(groups.every((g) => g.rows.length > 0)).toBe(true);
  });
});
