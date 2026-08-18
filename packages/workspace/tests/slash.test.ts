import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createSlashResolver,
  mapSlashRestToValues,
  parseRecipeYaml,
  parseSlashCommand,
  tryApplySlashRecipe,
  tryApplySlashSkill,
} from "../src/index.js";

const standup = parseRecipeYaml(`id: daily-standup
title: 日报整理
prompt: |
  notes: {{notes}}
instructions: |
  be brief
parameters:
  - name: notes
    description: raw
    required: true
`);

describe("slash", () => {
  it("parseSlashCommand extracts id and rest", () => {
    expect(parseSlashCommand("/daily-standup hello")).toEqual({
      id: "daily-standup",
      rest: "hello",
    });
    expect(parseSlashCommand("not slash")).toBeUndefined();
  });

  it("mapSlashRestToValues uses whole rest for one required param", () => {
    expect(mapSlashRestToValues(standup, "shipped M2")).toEqual({
      notes: "shipped M2",
    });
  });

  it("tryApplySlashRecipe expands known id", () => {
    const hit = tryApplySlashRecipe("/daily-standup shipped M2", [standup]);
    expect(hit?.recipeId).toBe("daily-standup");
    expect(hit?.userPrompt).toContain("shipped M2");
    expect(hit?.systemExtra).toContain("be brief");
  });

  it("unknown slash id returns undefined", () => {
    expect(tryApplySlashRecipe("/nope x", [standup])).toBeUndefined();
  });

  it("tryApplySlashSkill prepends body to rest", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "xrk-slash-skill-"));
    const product = path.join(root, ".xrk");
    const dir = path.join(product, "skills", "office-ping");
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, "SKILL.md"),
      `---
name: office-ping
description: Ping
---
Do the ping.
`,
      "utf8",
    );

    const hit = await tryApplySlashSkill("/office-ping do this", product);
    expect(hit?.recipeId).toBe("office-ping");
    expect(hit?.systemExtra).toBe("");
    expect(hit?.userPrompt).toContain("<skill_content name=\"office-ping\">");
    expect(hit?.userPrompt).toContain("Do the ping.");
    expect(hit?.userPrompt).toContain(dir);
    expect(hit?.userPrompt.endsWith("do this")).toBe(true);

    const only = await tryApplySlashSkill("/office-ping", product);
    expect(only?.userPrompt).toContain("Do the ping.");
    expect(only?.userPrompt).not.toContain("do this");
    expect(await tryApplySlashSkill("/missing", product)).toBeUndefined();
  });

  it("createSlashResolver prefers recipe over skill", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "xrk-slash-both-"));
    const product = path.join(root, ".xrk");
    const dir = path.join(product, "skills", "daily-standup");
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, "SKILL.md"),
      "# Skill body that must not win\n",
      "utf8",
    );
    const resolve = createSlashResolver({ productDir: product, recipes: [standup] });
    const hit = await resolve("/daily-standup shipped");
    expect(hit?.userPrompt).toContain("shipped");
    expect(hit?.userPrompt).not.toContain("Skill body");
    expect(hit?.systemExtra).toContain("be brief");
  });
});
