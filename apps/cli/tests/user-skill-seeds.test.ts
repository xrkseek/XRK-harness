import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ensureUserSkillSeeds } from "../src/user-skill-seeds.js";

describe("ensureUserSkillSeeds", () => {
  it("installs missing skills and skips existing SKILL.md", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "xrk-skill-seed-"));
    try {
      const first = await ensureUserSkillSeeds(home);
      expect(first.installed).toContain("xrk-capability-attach");
      const skillPath = path.join(
        home,
        "skills",
        "xrk-capability-attach",
        "SKILL.md",
      );
      const body = await readFile(skillPath, "utf8");
      expect(body).toContain("xrk-capability-attach");
      expect(body).toContain("settings.mutate");

      await mkdir(path.join(home, "skills", "xrk-capability-attach"), {
        recursive: true,
      });
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
