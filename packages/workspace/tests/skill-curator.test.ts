import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  listArchivedSkillDirs,
  runSkillCurator,
} from "../src/skill-curator.js";

const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function seedSkill(
  skillsRoot: string,
  name: string,
  mtimeMs: number,
): void {
  const dir = path.join(skillsRoot, name);
  mkdirSync(dir, { recursive: true });
  const skillMd = path.join(dir, "SKILL.md");
  writeFileSync(
    skillMd,
    `---
name: ${name}
description: Test skill ${name}
---
# ${name}
`,
    "utf8",
  );
  const at = new Date(mtimeMs);
  utimesSync(skillMd, at, at);
}

describe("skill curator", () => {
  it("archives stale skills and skips pinned / fresh ones", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "xrk-curator-"));
    temps.push(root);
    const skillsRoot = path.join(root, ".agents", "skills");
    const now = Date.parse("2026-09-25T00:00:00Z");
    const stale = now - 120 * 24 * 60 * 60 * 1000;
    const fresh = now - 10 * 24 * 60 * 60 * 1000;
    seedSkill(skillsRoot, "old-skill", stale);
    seedSkill(skillsRoot, "keep-pinned", stale);
    seedSkill(skillsRoot, "fresh-skill", fresh);

    const dry = await runSkillCurator({
      workspaceRoot: root,
      staleAfterDays: 90,
      pinned: ["keep-pinned"],
      dryRun: true,
      now: () => now,
    });
    expect(dry.candidates.map((c) => c.name).sort()).toEqual(["old-skill"]);
    expect(dry.skippedPinned).toContain("keep-pinned");
    expect(dry.archived).toEqual([]);

    const live = await runSkillCurator({
      workspaceRoot: root,
      staleAfterDays: 90,
      pinned: ["keep-pinned"],
      now: () => now,
    });
    expect(live.archived).toEqual(["old-skill"]);
    expect(listArchivedSkillDirs(skillsRoot)).toContain("old-skill");
  });
});
