import { describe, expect, it } from "vitest";
import {
  mapSlashRestToValues,
  parseRecipeYaml,
  parseSlashCommand,
  tryApplySlashRecipe,
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
});
