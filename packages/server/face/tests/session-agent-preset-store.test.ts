import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  clearSessionAgentPreset,
  loadSessionAgentPresets,
  saveSessionAgentPreset,
  sessionAgentPresetsPath,
} from "../src/session-agent-preset-store.js";
import {
  canonicalAgentPresetId,
  resolveAgentPresetProfile,
} from "../src/presets-catalog.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

describe("session-agent-preset-store", () => {
  it("persists and reloads pinned badges", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "xrk-sa-preset-"));
    dirs.push(dir);
    const file = sessionAgentPresetsPath(dir);
    saveSessionAgentPreset(file, "s1", "frugal");
    saveSessionAgentPreset(file, "s2", "harness");
    const loaded = loadSessionAgentPresets(file);
    expect(loaded.get("s1")).toBe("frugal");
    expect(loaded.get("s2")).toBe("harness");
    const raw = JSON.parse(readFileSync(file, "utf8")) as {
      version: number;
      presets: Record<string, string>;
    };
    expect(raw.version).toBe(1);
    expect(raw.presets.s1).toBe("frugal");
  });

  it("clears one session without dropping siblings", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "xrk-sa-preset-"));
    dirs.push(dir);
    const file = sessionAgentPresetsPath(dir);
    saveSessionAgentPreset(file, "keep", "shallow");
    saveSessionAgentPreset(file, "drop", "minimal");
    clearSessionAgentPreset(file, "drop");
    const loaded = loadSessionAgentPresets(file);
    expect(loaded.get("keep")).toBe("shallow");
    expect(loaded.has("drop")).toBe(false);
  });

  it("ignores unknown badge ids on load", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "xrk-sa-preset-"));
    dirs.push(dir);
    const file = sessionAgentPresetsPath(dir);
    writeFileSync(
      file,
      `${JSON.stringify({
        version: 1,
        presets: { ok: "frugal", bad: "not-a-badge" },
      })}\n`,
      "utf8",
    );
    const loaded = loadSessionAgentPresets(file);
    expect(loaded.get("ok")).toBe("frugal");
    expect(loaded.has("bad")).toBe(false);
  });
});

describe("frugal subagent policy", () => {
  it("keeps frugal / minimal / shell subagents off", () => {
    for (const id of ["frugal", "minimal", "shell"] as const) {
      expect(resolveAgentPresetProfile(id).subagents.mode).toBe("off");
      expect(canonicalAgentPresetId(id)).toBe(id);
    }
  });

  it("keeps shallow / harness subagents on", () => {
    expect(resolveAgentPresetProfile("shallow").subagents.mode).toBe("on");
    expect(resolveAgentPresetProfile("harness").subagents.mode).toBe("on");
  });
});
