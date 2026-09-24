import { describe, expect, it } from "vitest";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createHarnessComposition } from "../preset.js";

const DEFAULT_PERSONA =
  "You are a coding agent with filesystem, shell, and web tools.";

async function assemble(locale?: "zh" | "en"): Promise<string> {
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
    expect(prompt).toContain("界面语言为简体中文");
    // The directive must name reasoning explicitly, not just replies.
    expect(prompt).toContain("thinking / reasoning");
    // Code / identifiers stay verbatim — the directive must say so.
    expect(prompt).toContain("不要翻译");
    expect(prompt).not.toContain("The UI language is English");
  });

  it("keeps English reasoning when locale is en", async () => {
    const prompt = await assemble("en");
    expect(prompt).toContain("The UI language is English");
    expect(prompt).not.toContain("界面语言为简体中文");
  });

  it("follows the user's language when no preference was persisted", async () => {
    const prompt = await assemble();
    expect(prompt).toContain("No explicit UI locale was configured");
    // Never silently English-only: the fallback must bind to the user's text.
    expect(prompt).toContain("same natural language as the user's latest message");
  });

  it("sits after the persona and registers exactly once", async () => {
    const prompt = await assemble("zh");
    expect(prompt.indexOf(DEFAULT_PERSONA)).toBeLessThan(
      prompt.indexOf("# Language"),
    );
    expect(count(prompt, "# Language")).toBe(1);
  });
});
