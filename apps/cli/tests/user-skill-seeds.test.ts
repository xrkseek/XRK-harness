import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureUserSkillSeeds } from "../src/user-skill-seeds.js";

describe("ensureUserSkillSeeds", () => {
  it("defers by default and does not create ~/.xrk/skills", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "xrk-skill-seed-"));
    try {
      const first = await ensureUserSkillSeeds(home);
      expect(first.deferred).toBe(true);
      expect(first.installed).toEqual([]);
      expect(existsSync(path.join(home, "skills"))).toBe(false);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("force installs missing skills and skips existing SKILL.md", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "xrk-skill-seed-"));
    try {
      const first = await ensureUserSkillSeeds(home, { force: true });
      expect(first.deferred).toBe(false);
      expect(first.installed).toContain("xrk-capability-attach");
      expect(first.installed).toContain("xrk-create-skill");
      expect(first.installed).toContain("xrk-adapt-workspace");
      const skillPath = path.join(
        home,
        "skills",
        "xrk-capability-attach",
        "SKILL.md",
      );
      const body = await readFile(skillPath, "utf8");
      expect(body).toContain("xrk-capability-attach");

      await writeFile(skillPath, "user-edited\n", "utf8");
      const second = await ensureUserSkillSeeds(home, { force: true });
      expect(second.installed).not.toContain("xrk-capability-attach");
      expect(second.skipped).toContain("xrk-capability-attach");
      expect(await readFile(skillPath, "utf8")).toBe("user-edited\n");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("seeds when skills dir already exists without force", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "xrk-skill-seed-"));
    try {
      await mkdir(path.join(home, "skills"), { recursive: true });
      const r = await ensureUserSkillSeeds(home);
      expect(r.deferred).toBe(false);
      expect(r.installed.length).toBeGreaterThan(0);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
