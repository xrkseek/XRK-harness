import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createSkillTools,
  formatSkillCatalog,
  isSkillName,
  listSkills,
  loadSkill,
  parseSkillMarkdown,
} from "../src/index.js";

describe("skills", () => {
  it("rejects path-like names", () => {
    expect(isSkillName("office-ping")).toBe(true);
    expect(isSkillName("../secret")).toBe(false);
    expect(isSkillName("a/b")).toBe(false);
    expect(isSkillName("")).toBe(false);
  });

  it("parses frontmatter and lists SKILL.md dirs only", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "xrk-skill-"));
    const product = path.join(root, ".xrk");
    const dir = path.join(product, "skills", "office-ping");
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, "SKILL.md"),
      `---
name: office-ping
description: Ping skill for tests
whenToUse: when testing skill.list
---
# Office ping

Do the ping.
`,
      "utf8",
    );
    await writeFile(path.join(product, "skills", "not-a-dir"), "x", "utf8");

    const listed = await listSkills({ productDir: product });
    expect(listed).toEqual([
      {
        name: "office-ping",
        description: "Ping skill for tests",
        whenToUse: "when testing skill.list",
        modelInvocable: true,
        dirName: "office-ping",
        directory: dir,
      },
    ]);
    expect(formatSkillCatalog(listed)).toContain("**office-ping**");
    const loaded = await loadSkill({ productDir: product, name: "office-ping" });
    expect(loaded?.content).toContain("Do the ping.");
    expect(parseSkillMarkdown("---\nname: x\n---\n# Hi", "x").content).toBe(
      "# Hi",
    );
  });

  it("skill tool loads body and rejects unknown names", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "xrk-skill-"));
    const product = path.join(root, ".xrk");
    const dir = path.join(product, "skills", "notes");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "SKILL.md"), "# Notes\nKeep it short.\n", "utf8");
    const tool = createSkillTools({ productDir: product }).find(
      (t) => t.name === "skill",
    )!;
    const ok = await tool.execute({ name: "notes" });
    expect(ok.isError).toBeUndefined();
    expect(ok.content).toContain("<skill_content name=\"notes\">");
    expect(ok.content).toContain("Keep it short.");
    expect(ok.content).toContain(dir);
    const miss = await tool.execute({ name: "missing" });
    expect(miss.isError).toBe(true);
    expect(tool.presentCall?.({ name: "notes" })).toEqual({
      card: "generic",
      title: "Load skill notes",
      kind: "read",
      rawInput: "notes",
    });
  });
});
