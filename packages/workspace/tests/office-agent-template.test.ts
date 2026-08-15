import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../templates/office-agent",
);

const REQUIRED = [
  "SOUL.md",
  "USER.md",
  "IDENTITY.md",
  "AGENTS.md",
  "TOOLS.md",
  "assistant.md",
  "rules.md",
  "subagents.md",
  "recipes/daily-standup.yaml",
  "README.md",
] as const;

describe("office-agent template contract", () => {
  it("has required seed files", async () => {
    for (const rel of REQUIRED) {
      await access(path.join(root, rel));
    }
  });

  it("product AGENTS.md is isolated from repo coding agents path", async () => {
    const text = await readFile(path.join(root, "AGENTS.md"), "utf8");
    expect(text).toContain("产品工作区种子");
    expect(text).not.toContain("data/ai-workspace");
  });

  it("recipe daily-standup has id and notes param", async () => {
    const yaml = await readFile(
      path.join(root, "recipes/daily-standup.yaml"),
      "utf8",
    );
    expect(yaml).toMatch(/^id:\s*daily-standup/m);
    expect(yaml).toContain("name: notes");
  });
});
