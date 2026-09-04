import { describe, expect, it } from "vitest";
import {
  FACE_AGENT_PRESETS,
  canonicalAgentPresetId,
  resolveAgentPresetProfile,
  resolveToolPreset,
  DEFAULT_MAX_ACTIVE_CHILDREN,
} from "../src/presets-catalog.js";

describe("agentPreset catalog", () => {
  it("UI catalog is six tiers light → full", () => {
    expect(FACE_AGENT_PRESETS.map((p) => p.id)).toEqual([
      "minimal",
      "shell",
      "frugal",
      "plan",
      "shallow",
      "harness",
    ]);
  });

  it("legacy server maps to harness tools", () => {
    expect(resolveToolPreset("server", "minimal")).toBe("harness");
    expect(canonicalAgentPresetId("server")).toBe("harness");
  });

  it("host fallback seeds when session badge omitted", () => {
    expect(resolveToolPreset(undefined, "minimal")).toBe("minimal");
    expect(resolveToolPreset(undefined, "server")).toBe("harness");
    expect(resolveToolPreset(undefined, "harness")).toBe("harness");
  });

  it("frugal / plan / shallow profiles match product policy", () => {
    const frugal = resolveAgentPresetProfile("frugal");
    expect(frugal.composition).toBe("harness");
    expect(frugal.subagents.mode).toBe("off");
    expect(frugal.subagentRouting).toBe(false);
    expect(frugal.tools).toEqual({ web: true, lsp: true, pty: true });

    const plan = resolveAgentPresetProfile("plan");
    expect(plan.planModeDefault).toBe(true);
    expect(plan.subagents.mode).toBe("off");

    const shallow = resolveAgentPresetProfile("shallow");
    expect(shallow.subagents).toEqual({
      mode: "on",
      maxDepth: 1,
      maxActiveChildren: DEFAULT_MAX_ACTIVE_CHILDREN,
    });

    const shell = resolveAgentPresetProfile("shell");
    expect(shell.tools).toEqual({ web: false, lsp: false, pty: true });
    expect(shell.subagents.mode).toBe("off");
  });
});
