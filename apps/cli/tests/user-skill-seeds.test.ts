import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ensureUserHomeSeeds,
  ensureUserSkillSeeds,
  ensureUserStandingSeeds,
  ensureUserRecipeSeeds,
} from "../src/user-skill-seeds.js";

/** Build a fake bundled-seed root: `{ seedRoot }/<name>/<file>`. */
async function makeSeedRoot(
  seedRoot: string,
  skills: Record<string, Record<string, string>>,
): Promise<void> {
  for (const [name, files] of Object.entries(skills)) {
    const dir = path.join(seedRoot, name);
    await mkdir(dir, { recursive: true });
    for (const [file, content] of Object.entries(files)) {
      await writeFile(path.join(dir, file), content, "utf8");
    }
  }
}

const skillMd = (name: string, description: string): string =>
  `---\nname: ${name}\ndescription: ${description}\n---\n# ${description}\n`;

async function withTempDirs(
  run: (home: string, seeds: string) => Promise<void>,
): Promise<void> {
  const home = await mkdtemp(path.join(os.tmpdir(), "xrk-skill-seed-home-"));
  const seeds = await mkdtemp(path.join(os.tmpdir(), "xrk-skill-seed-src-"));
  try {
    await run(home, seeds);
  } finally {
    await rm(home, { recursive: true, force: true });
    await rm(seeds, { recursive: true, force: true });
  }
}

describe("ensureUserSkillSeeds", () => {
  it("creates home skills on establish and skips existing SKILL.md", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "xrk-skill-seed-"));
    try {
      const first = await ensureUserSkillSeeds(home);
      expect(existsSync(path.join(home, "skills"))).toBe(true);
      expect(first.installed).toContain("xrk-capability-attach");
      expect(first.installed).toContain("xrk-create-skill");
      expect(first.installed).toContain("xrk-adapt-workspace");
      expect(first.installed).toContain("xrk-plan-build");
      expect(first.installed).toContain("xrk-delegate");
      expect(first.installed).toContain("xrk-code-review");
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

  it("refreshes a pristine home copy when the bundled seed changes", async () => {
    await withTempDirs(async (home, seeds) => {
      await makeSeedRoot(seeds, { demo: { "SKILL.md": skillMd("demo", "v1") } });
      const dest = path.join(home, "skills", "demo", "SKILL.md");

      const first = await ensureUserSkillSeeds(home, seeds);
      expect(first.installed).toEqual(["demo"]);
      expect(first.refreshed).toEqual([]);
      expect(await readFile(dest, "utf8")).toContain("v1");

      // The CLI ships a newer generation of the same seed.
      await writeFile(
        path.join(seeds, "demo", "SKILL.md"),
        skillMd("demo", "v2"),
        "utf8",
      );

      const second = await ensureUserSkillSeeds(home, seeds);
      expect(second.installed).toEqual([]);
      expect(second.refreshed).toEqual(["demo"]);
      expect(await readFile(dest, "utf8")).toContain("v2");

      // Idempotent: an unchanged bundle is a no-op.
      const third = await ensureUserSkillSeeds(home, seeds);
      expect(third.installed).toEqual([]);
      expect(third.refreshed).toEqual([]);
      expect(third.skipped).toContain("demo");
    });
  });

  it("never clobbers a user edit, even when the seed changes", async () => {
    await withTempDirs(async (home, seeds) => {
      await makeSeedRoot(seeds, { demo: { "SKILL.md": skillMd("demo", "v1") } });
      await ensureUserSkillSeeds(home, seeds);
      const dest = path.join(home, "skills", "demo", "SKILL.md");

      await writeFile(dest, "user-edited\n", "utf8");
      await writeFile(
        path.join(seeds, "demo", "SKILL.md"),
        skillMd("demo", "v2"),
        "utf8",
      );

      const second = await ensureUserSkillSeeds(home, seeds);
      expect(second.refreshed).toEqual([]);
      expect(second.skipped).toContain("demo");
      expect(await readFile(dest, "utf8")).toBe("user-edited\n");
    });
  });

  it("leaves a pre-manifest home copy alone (provenance unknown)", async () => {
    await withTempDirs(async (home, seeds) => {
      // Simulate an install written by an older CLI: no `.seed-manifest.json`.
      const dir = path.join(home, "skills", "demo");
      await mkdir(dir, { recursive: true });
      await writeFile(
        path.join(dir, "SKILL.md"),
        skillMd("demo", "ancient"),
        "utf8",
      );
      await makeSeedRoot(seeds, { demo: { "SKILL.md": skillMd("demo", "v2") } });

      const res = await ensureUserSkillSeeds(home, seeds);
      expect(res.installed).toEqual([]);
      expect(res.refreshed).toEqual([]);
      expect(res.skipped).toContain("demo");
      expect(await readFile(path.join(dir, "SKILL.md"), "utf8")).toContain(
        "ancient",
      );
    });
  });

  it("drops seed files that disappeared, instead of merging them in", async () => {
    await withTempDirs(async (home, seeds) => {
      await makeSeedRoot(seeds, {
        demo: { "SKILL.md": skillMd("demo", "v1"), "legacy.md": "obsolete\n" },
      });
      await ensureUserSkillSeeds(home, seeds);
      const legacy = path.join(home, "skills", "demo", "legacy.md");
      expect(existsSync(legacy)).toBe(true);

      // Newer bundle no longer ships `legacy.md`.
      await rm(path.join(seeds, "demo", "legacy.md"), { force: true });
      await writeFile(
        path.join(seeds, "demo", "SKILL.md"),
        skillMd("demo", "v2"),
        "utf8",
      );

      const second = await ensureUserSkillSeeds(home, seeds);
      expect(second.refreshed).toEqual(["demo"]);
      expect(existsSync(legacy)).toBe(false);
    });
  });

  it("writes a machine-readable seed manifest next to the skills", async () => {
    await withTempDirs(async (home, seeds) => {
      await makeSeedRoot(seeds, { demo: { "SKILL.md": skillMd("demo", "v1") } });
      await ensureUserSkillSeeds(home, seeds);

      const manifestFile = path.join(home, "skills", ".seed-manifest.json");
      expect(existsSync(manifestFile)).toBe(true);
      const parsed = JSON.parse(await readFile(manifestFile, "utf8")) as Record<
        string,
        unknown
      >;
      expect(Object.keys(parsed)).toEqual(["demo"]);
      expect(typeof parsed.demo).toBe("string");
      expect((parsed.demo as string)).toHaveLength(64); // sha256 hex
    });
  });

  it("survives a corrupt manifest without touching home copies", async () => {
    await withTempDirs(async (home, seeds) => {
      await makeSeedRoot(seeds, { demo: { "SKILL.md": skillMd("demo", "v1") } });
      await ensureUserSkillSeeds(home, seeds);

      await writeFile(
        path.join(home, "skills", ".seed-manifest.json"),
        "{not json",
        "utf8",
      );
      await writeFile(
        path.join(seeds, "demo", "SKILL.md"),
        skillMd("demo", "v2"),
        "utf8",
      );

      const res = await ensureUserSkillSeeds(home, seeds);
      // Unreadable manifest → unknown provenance → leave the home copy alone.
      expect(res.refreshed).toEqual([]);
      expect(res.skipped).toContain("demo");
      expect(
        await readFile(path.join(home, "skills", "demo", "SKILL.md"), "utf8"),
      ).toContain("v1");
    });
  });

  it("is a no-op when the bundled seed root is missing", async () => {
    await withTempDirs(async (home, seeds) => {
      const res = await ensureUserSkillSeeds(home, path.join(seeds, "absent"));
      expect(res.installed).toEqual([]);
      expect(res.refreshed).toEqual([]);
      expect(res.skipped).toEqual([]);
      expect(res.homeSkills).toBe(path.join(home, "skills"));
    });
  });

  it("seeds a thin AGENTS.md and recipes under home", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "xrk-home-seed-"));
    try {
      const all = await ensureUserHomeSeeds(home);
      expect(all.standing.installed).toContain("AGENTS.md");
      expect(await readFile(path.join(home, "AGENTS.md"), "utf8")).toContain(
        "Global preferences",
      );
      expect(all.recipes.installed.length).toBeGreaterThan(0);
      expect(existsSync(path.join(home, "recipes", "plan-build.yaml"))).toBe(
        true,
      );
      // No persona stack dumped into home.
      expect(existsSync(path.join(home, "SOUL.md"))).toBe(false);
      expect(existsSync(path.join(home, "IDENTITY.md"))).toBe(false);

      const again = await ensureUserStandingSeeds(home);
      expect(again.installed).toEqual([]);
      expect(again.skipped).toContain("AGENTS.md");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("refreshes a pristine recipe when the bundle changes", async () => {
    await withTempDirs(async (home, seeds) => {
      const seedRecipes = path.join(seeds, "recipes");
      await mkdir(seedRecipes, { recursive: true });
      await writeFile(
        path.join(seedRecipes, "demo.yaml"),
        "id: demo\ntitle: Demo\nprompt: |\n  v1\nparameters: []\n",
        "utf8",
      );
      const first = await ensureUserRecipeSeeds(home, seedRecipes);
      expect(first.installed).toEqual(["demo.yaml"]);
      await writeFile(
        path.join(seedRecipes, "demo.yaml"),
        "id: demo\ntitle: Demo\nprompt: |\n  v2\nparameters: []\n",
        "utf8",
      );
      const second = await ensureUserRecipeSeeds(home, seedRecipes);
      expect(second.refreshed).toEqual(["demo.yaml"]);
      expect(
        await readFile(path.join(home, "recipes", "demo.yaml"), "utf8"),
      ).toContain("v2");
    });
  });
});
