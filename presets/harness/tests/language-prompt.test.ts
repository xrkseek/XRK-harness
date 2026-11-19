import { describe, expect, it } from "vitest";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createHarnessComposition } from "../preset.js";

const DEFAULT_PERSONA = "You are a coding agent with filesystem, shell, and web tools.";

async function assemble(locale?: "zh" | "en" | "ja"): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "xrk-lang-"));
  const composition = createHarnessComposition({
    workspaceRoot: root,
    assemble: false,
    workspaceInject: false,
    slashRecipes: false,
    ...(locale ? { locale } : {}),
  });
  return composition.prompts.assemble();
}

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe("harness language prompt section (Face `locale`)", () => {
  it("forces Chinese reasoning and replies when locale is zh", async () => {
    const prompt = await assemble("zh");
    expect(prompt).toContain("# Language");
    expect(prompt).toContain("界面=简体中文");
    expect(prompt).toContain("勿用英文起笔推理");
    expect(prompt).toContain("不译");
    expect(prompt).not.toContain("UI=English");
  });

  it("keeps English reasoning when locale is en", async () => {
    const prompt = await assemble("en");
    expect(prompt).toContain("UI=English");
    expect(prompt).not.toContain("界面=简体中文");
  });

  it("forces Japanese reasoning and replies when locale is ja", async () => {
    const prompt = await assemble("ja");
    expect(prompt).toContain("UI=日本語");
    expect(prompt).toContain("英語で推論を始めない");
    expect(prompt).toContain("訳さない");
    expect(prompt).not.toContain("UI=English");
    expect(prompt).not.toContain("界面=简体中文");
  });

  it("follows the user's language when no preference was persisted", async () => {
    const prompt = await assemble();
    expect(prompt).toContain("Match the user's latest message language");
    expect(prompt).toContain("Chinese");
  });

  it("sits after the persona and registers exactly once", async () => {
    const prompt = await assemble("zh");
    expect(prompt.indexOf(DEFAULT_PERSONA)).toBeLessThan(prompt.indexOf("# Language"));
    expect(count(prompt, "# Language")).toBe(1);
  });
});
