import { describe, expect, it } from "vitest";
import path from "node:path";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  createSkillSearchTool,
  searchSkillsByQuery,
  SKILL_SEARCH_NAME,
} from "../src/skill-search.js";
import { createSkillTools } from "../src/skill-tools.js";
import type { SkillSummary } from "../src/skills.js";

function skill(name: string, description: string): SkillSummary {
  return {
    name,
    description,
    content: "",
    modelInvocable: true,
    userInvocable: true,
    invalid: false,
  };
}

describe("searchSkillsByQuery", () => {
  it("ranks by name and description tokens", () => {
    const lib = [
      skill("xrk-delegate", "Spawn subagents and team homes"),
      skill("xrk-craft", "Lazy craft ladder for code"),
      skill("lint", "Run eslint"),
    ];
    const hits = searchSkillsByQuery(lib, "subagent spawn team", 8);
    expect(hits[0]?.name).toBe("xrk-delegate");
  });
});

describe("createSkillSearchTool", () => {
  it("lists names on browse and blurbs on keyword", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "xrk-skill-search-"));
    try {
      const dir = path.join(root, "skills", "demo-browser");
      await mkdir(dir, { recursive: true });
      await writeFile(
        path.join(dir, "SKILL.md"),
        "---\nname: demo-browser\ndescription: Drive a headed browser for UI checks\n---\n# Body\n",
        "utf8",
      );
      const tool = createSkillSearchTool({
        skillDirs: [path.join(root, "skills")],
        workspaceRoot: root,
      });
      expect(tool.name).toBe(SKILL_SEARCH_NAME);
      const listed = await tool.execute({ query: "list" }, {} as never);
      expect(String(listed.content)).toContain("demo-browser");
      expect(String(listed.content)).not.toContain("Drive a headed");
      const hit = await tool.execute({ query: "browser ui" }, {} as never);
      expect(String(hit.content)).toContain("demo-browser");
      expect(String(hit.content)).toContain("Drive a headed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("createSkillTools registers skill_search before skill", () => {
    const tools = createSkillTools({
      skillDirs: [],
      workspaceRoot: "/tmp",
    });
    expect(tools.map((t) => t.name)).toEqual(["skill_search", "skill"]);
  });
});
