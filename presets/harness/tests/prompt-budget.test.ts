import { describe, expect, it } from "vitest";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createHarnessComposition } from "../preset.js";

/**
 * First-turn system-prompt diet lock.
 * Contracts live on tools[]; this budget guards against quiet re-bloat.
 */
async function assembleDefaultCoding(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "xrk-prompt-budget-"));
  const composition = createHarnessComposition({
    workspaceRoot: root,
    assemble: false,
    workspaceInject: false,
    slashRecipes: false,
    locale: "zh",
    // Typical coding seat: no keyless gen / voice / computer-use noise.
    imageGenTools: false,
    videoGenTools: false,
    videoAnalyzeTools: false,
    voiceTools: false,
    computerUseTools: false,
    lspTools: false,
  });
  return composition.prompts.assemble();
}

describe("harness system prompt budget (first-turn diet)", () => {
  it("stays under the coding-seat ceiling and avoids known duplicates", async () => {
    const prompt = await assembleDefaultCoding();
    // Soft ceiling after 2026-11 diet passes (~6–8k was common before).
    expect(prompt.length).toBeLessThan(12_000);
    expect(prompt).toContain("# Language");
    expect(prompt).toContain("Web family:");
    expect(prompt).toContain("Subagents:");
    expect(prompt).toContain("File tools:");
    expect(prompt).toContain("Shell:");
    // Jobs settle folded into shell — no empty/duplicate jobs lecture.
    expect(prompt).not.toMatch(/^Jobs:/m);
    expect(prompt).not.toContain("permission_label:");
    expect(prompt).not.toContain("surface_brief:");
    // Delegation posture once (tool:subagent), not also in surface-pack.
    expect(prompt.split("Delegation:").length - 1).toBe(1);
    // Search/fetch contracts live inside web_family (one section).
    expect(prompt).toContain("web_search:");
    expect(prompt).toContain("web_fetch:");
  });
});
