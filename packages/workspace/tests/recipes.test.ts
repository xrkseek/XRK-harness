import { describe, expect, it } from "vitest";
import { applyRecipe, parseRecipeYaml } from "../src/index.js";

describe("recipes", () => {
  it("parses daily-standup and expands notes", () => {
    const recipe = parseRecipeYaml(`id: daily-standup
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
    expect(recipe.id).toBe("daily-standup");
    const applied = applyRecipe(recipe, { notes: "shipped M2" });
    expect(applied.userPrompt).toContain("shipped M2");
    expect(applied.systemExtra).toContain("be brief");
  });
});
