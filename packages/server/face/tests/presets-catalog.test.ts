import { describe, expect, it } from "vitest";
import {
  FACE_AGENT_PRESETS,
  canonicalAgentPresetId,
  resolveAgentPresetProfile,
  resolveToolPreset,
  DEFAULT_MAX_ACTIVE_CHILDREN,
  DEFAULT_MAX_DEPTH,
} from "../src/presets-catalog.js";

describe("agentPreset catalog", () => {
  it("UI catalog is five tiers light → full (plan is /plan, not a badge)", () => {
    expect(FACE_AGENT_PRESETS.map((p) => p.id)).toEqual([
      "minimal",
      "shell",
      "frugal",
      "shallow",
      "harness",
    ]);
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

  it("frugal / shallow profiles match product policy", () => {
    const frugal = resolveAgentPresetProfile("frugal");
    expect(frugal.composition).toBe("harness");
    expect(frugal.subagents.mode).toBe("off");
    expect(frugal.subagentRouting).toBe(false);
    expect(frugal.tools).toEqual({ web: true, lsp: true, pty: true });

    const shallow = resolveAgentPresetProfile("shallow");
    expect(shallow.subagents).toEqual({
      mode: "on",
      maxDepth: 1,
    });
    const harness = resolveAgentPresetProfile("harness");
    expect(harness.subagents).toEqual({ mode: "on" });
    expect(DEFAULT_MAX_DEPTH).toBe(2);
    expect(DEFAULT_MAX_ACTIVE_CHILDREN).toBe(2);
  });
});
