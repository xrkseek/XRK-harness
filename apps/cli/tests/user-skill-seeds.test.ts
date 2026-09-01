import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureUserSkillSeeds } from "../src/user-skill-seeds.js";

describe("ensureUserSkillSeeds", () => {
  it("creates home skills on establish and skips existing SKILL.md", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "xrk-skill-seed-"));
    try {
      const first = await ensureUserSkillSeeds(home);
      expect(existsSync(path.join(home, "skills"))).toBe(true);
      expect(first.installed).toContain("xrk-capability-attach");
      expect(first.installed).toContain("xrk-create-skill");
      expect(first.installed).toContain("xrk-adapt-workspace");
      const skillPath = path.join(
        home,
        "skills",
        "xrk-capability-attach",
        "SKILL.md",
      );
      expect(await readFile(skillPath, "utf8")).toContain("xrk-capability-attach");

      await writeFile(skillPath, "user-edited\n", "utf8");
      const second = await ensureUserSkillSeeds(home);
      expect(second.installed).not.toContain("xrk-capability-attach");
      expect(second.skipped).toContain("xrk-capability-attach");
      expect(await readFile(skillPath, "utf8")).toBe("user-edited\n");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
