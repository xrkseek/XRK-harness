import { describe, expect, it } from "vitest";
import {
  FACE_AGENT_PRESETS,
  canonicalAgentPresetId,
  isPeerCollabBadge,
  resolveAgentPresetProfile,
  resolveToolPreset,
  DEFAULT_MAX_ACTIVE_CHILDREN,
  DEFAULT_MAX_DEPTH,
  SHALLOW_MAX_CONCURRENT_MODEL_SESSIONS,
} from "../src/presets-catalog.js";

describe("agentPreset catalog", () => {
  it("UI catalog is coding light→full then workspace-locked IM / Qichuang", () => {
    expect(FACE_AGENT_PRESETS.map((p) => p.id)).toEqual([
      "minimal",
      "shell",
      "frugal",
      "shallow",
      "harness",
      "im",
      "qichuang",
    ]);
    expect(FACE_AGENT_PRESETS.find((p) => p.id === "im")?.workspaceLocked).toBe(true);
    expect(FACE_AGENT_PRESETS.find((p) => p.id === "qichuang")?.workspaceLocked).toBe(
      true,
    );
    expect(resolveAgentPresetProfile("im").composition).toBe("minimal");
    expect(resolveAgentPresetProfile("im").subagents.mode).toBe("on");
    expect(resolveAgentPresetProfile("im").subagentRouting).toBe(true);
    expect(resolveAgentPresetProfile("im").delegation).toBe("proactive");
    const qichuang = resolveAgentPresetProfile("qichuang");
    expect(qichuang.composition).toBe("harness");
    expect(qichuang.tools).toEqual({
      bash: true,
      skill: true,
      web: true,
      lsp: true,
      pty: true,
      office: true,
    });
    expect(qichuang.subagents.mode).toBe("off");
  });

  it("legacy server / plan map to harness tools", () => {
    expect(resolveToolPreset("server", "minimal")).toBe("harness");
    expect(canonicalAgentPresetId("server")).toBe("harness");
    expect(canonicalAgentPresetId("plan")).toBe("harness");
    expect(resolveAgentPresetProfile("plan").planModeDefault).toBe(false);
  });

  it("host fallback seeds when session badge omitted", () => {
    expect(resolveToolPreset(undefined, "minimal")).toBe("minimal");
    expect(resolveToolPreset(undefined, "server")).toBe("harness");
    expect(resolveToolPreset(undefined, "harness")).toBe("harness");
  });

  it("PI / Shell / Frugal / Shallow / Harness match product surface matrix", () => {
    const pi = resolveAgentPresetProfile("minimal");
    expect(pi.composition).toBe("minimal");
    expect(pi.tools).toEqual({
      bash: false,
      skill: false,
      web: false,
      lsp: false,
      pty: false,
      office: false,
    });
    expect(pi.subagents.mode).toBe("off");
    expect(FACE_AGENT_PRESETS.find((p) => p.id === "minimal")?.displayName).toBe(
      "PI",
    );

    const shell = resolveAgentPresetProfile("shell");
    expect(shell.tools).toEqual({
      bash: true,
      skill: true,
      web: false,
      lsp: false,
      pty: true,
      office: false,
    });
    expect(shell.subagents.mode).toBe("off");

    const frugal = resolveAgentPresetProfile("frugal");
    expect(frugal.composition).toBe("harness");
    expect(frugal.subagents.mode).toBe("off");
    expect(frugal.subagentRouting).toBe(false);
    expect(frugal.tools).toEqual({
      bash: true,
      skill: true,
      web: true,
      lsp: true,
      pty: true,
      office: true,
    });

    const shallow = resolveAgentPresetProfile("shallow");
    expect(shallow.subagents).toEqual({ mode: "on" });
    const harness = resolveAgentPresetProfile("harness");
    expect(harness.subagents).toEqual({ mode: "on" });
    expect(harness.tools).toEqual(frugal.tools);

    expect(isPeerCollabBadge("minimal")).toBe(false);
    expect(isPeerCollabBadge("shell")).toBe(false);
    expect(isPeerCollabBadge("frugal")).toBe(false);
    expect(isPeerCollabBadge("shallow")).toBe(true);
    expect(isPeerCollabBadge("harness")).toBe(true);

    expect(SHALLOW_MAX_CONCURRENT_MODEL_SESSIONS).toBe(2);
    // Legacy exports kept for importers; live ceiling is per-model sessions.
    expect(DEFAULT_MAX_DEPTH).toBe(0);
    expect(DEFAULT_MAX_ACTIVE_CHILDREN).toBe(0);
  });
});
