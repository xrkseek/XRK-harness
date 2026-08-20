import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createSkillTools,
  formatSkillCatalog,
  isSkillName,
  listSkills,
  listSkillsFromWorkspace,
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

  it("imports .claude and .xrk when present; skips missing roots", async () => {
    const ws = await mkdtemp(path.join(tmpdir(), "xrk-skill-multi-"));
    const claudeDir = path.join(ws, ".claude", "skills", "from-claude");
    const xrkDir = path.join(ws, ".xrk", "skills", "from-xrk");
    await mkdir(claudeDir, { recursive: true });
    await mkdir(xrkDir, { recursive: true });
    await writeFile(
      path.join(claudeDir, "SKILL.md"),
      "---\nname: from-claude\ndescription: Claude skill\n---\n# C\n",
      "utf8",
    );
    await writeFile(
      path.join(xrkDir, "SKILL.md"),
      "---\nname: from-xrk\ndescription: XRK skill\n---\n# X\n",
      "utf8",
    );
    const listed = await listSkillsFromWorkspace(ws, { includeUserHome: false });
    expect(listed.map((s) => s.name).sort()).toEqual(["from-claude", "from-xrk"]);
    expect(
      await loadSkill({
        workspaceRoot: ws,
        includeUserHome: false,
        name: "from-claude",
      }),
    ).toMatchObject({ name: "from-claude" });
  });

  it(".xrk wins over .claude on the same skill name", async () => {
    const ws = await mkdtemp(path.join(tmpdir(), "xrk-skill-overlay-"));
    const claudeDir = path.join(ws, ".claude", "skills", "shared");
    const xrkDir = path.join(ws, ".xrk", "skills", "shared");
    await mkdir(claudeDir, { recursive: true });
    await mkdir(xrkDir, { recursive: true });
    await writeFile(
      path.join(claudeDir, "SKILL.md"),
      "---\nname: shared\ndescription: from claude\n---\n# Claude\n",
      "utf8",
    );
    await writeFile(
      path.join(xrkDir, "SKILL.md"),
      "---\nname: shared\ndescription: from xrk\n---\n# Xrk\n",
      "utf8",
    );
    const listed = await listSkillsFromWorkspace(ws, { includeUserHome: false });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.description).toBe("from xrk");
    expect(listed[0]?.directory).toBe(xrkDir);
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
