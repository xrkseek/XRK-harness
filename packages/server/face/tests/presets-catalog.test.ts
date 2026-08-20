import { describe, expect, it } from "vitest";
import {
  FACE_AGENT_PRESETS,
  canonicalAgentPresetId,
  resolveToolPreset,
} from "../src/presets-catalog.js";

describe("agentPreset catalog", () => {
  it("UI catalog is only minimal | harness", () => {
    expect(FACE_AGENT_PRESETS.map((p) => p.id)).toEqual(["minimal", "harness"]);
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
});
