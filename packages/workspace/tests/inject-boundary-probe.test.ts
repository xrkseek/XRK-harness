import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  createWorkspaceInjector,
  resolveWorkspaceInject,
  standingSkillToolSourceOptions,
} from "../src/index.js";
import { listSkills } from "../src/skills.js";
import { resolveUserProductHome } from "../src/user-product-home.js";

const roots: string[] = [];
async function tmp(prefix: string) {
  const d = await mkdtemp(path.join(tmpdir(), prefix));
  roots.push(d);
  return d;
}
afterAll(async () => {
  for (const d of roots) await rm(d, { recursive: true, force: true });
});

describe("inject boundary regressions", () => {
  it("Product home anchor follows resolve homeDir", async () => {
    const root = await tmp("xrk-ph-");
    const fakeHome = await tmp("xrk-phh-");
    await mkdir(path.join(fakeHome, ".xrk"), { recursive: true });
    const fakeProduct = resolveUserProductHome(fakeHome);
    const resolved = await resolveWorkspaceInject({
      root,
      productDir: path.join(root, ".xrk"),
      homeDir: fakeHome,
    });
    const head = resolved.instructionBlocks[0] ?? "";
    expect(head).toContain("## Product home");
    expect(head).toContain(fakeProduct);
  });

  it(".agents/SOUL.md is not injected; .xrk/SOUL.md is", async () => {
    const root = await tmp("xrk-soul-");
    const home = await tmp("xrk-soulh-");
    await mkdir(path.join(root, ".agents"), { recursive: true });
    await writeFile(
      path.join(root, ".agents", "SOUL.md"),
      "AGENTS_SOUL_MARKER",
      "utf8",
    );
    await mkdir(path.join(root, ".xrk"), { recursive: true });
    await writeFile(
      path.join(root, ".xrk", "SOUL.md"),
      "XRK_SOUL_MARKER",
      "utf8",
    );
    const out = await createWorkspaceInjector({
      root,
      homeDir: home,
      includeUserHome: false,
    }).inject();
    const joined = out.instructionBlocks.join("\n");
    expect(joined).toContain("XRK_SOUL_MARKER");
    expect(joined).not.toContain("AGENTS_SOUL_MARKER");
  });

  it("minimal catalog = seed + briefcase; subagent keeps project skills", async () => {
    const root = await tmp("xrk-cat-");
    const home = await tmp("xrk-cath-");
    await mkdir(path.join(home, ".xrk", "skills", "seeded"), {
      recursive: true,
    });
    await writeFile(
      path.join(home, ".xrk", "skills", "seeded", "SKILL.md"),
      "---\ndescription: Seed\n---\n# S\n",
      "utf8",
    );
    await mkdir(path.join(root, ".agents", "skills", "proj"), {
      recursive: true,
    });
    await writeFile(
      path.join(root, ".agents", "skills", "proj", "SKILL.md"),
      "---\ndescription: Proj\n---\n# P\n",
      "utf8",
    );
    const brief = path.join(home, "briefcase");
    await mkdir(path.join(brief, "pack"), { recursive: true });
    await writeFile(
      path.join(brief, "pack", "SKILL.md"),
      "---\ndescription: Pack\n---\n# B\n",
      "utf8",
    );

    const min = await createWorkspaceInjector({
      root,
      homeDir: home,
      audience: "minimal",
      extraSkillDirs: [brief],
    }).inject();
    // audience no longer thins workspace skill trees (badge/tools ≠ context).
    expect(min.skillCatalog?.source.entries.map((e) => e.name).sort()).toEqual([
      "pack",
      "proj",
      "seeded",
    ]);

    const toolRoots = await listSkills(
      standingSkillToolSourceOptions({
        workspaceRoot: root,
        homeDir: home,
        audience: "minimal",
        extraSkillDirs: [brief],
      }),
    );
    expect(toolRoots.map((e) => e.name).sort()).toEqual([
      "pack",
      "proj",
      "seeded",
    ]);

    const sub = await createWorkspaceInjector({
      root,
      homeDir: home,
      audience: "subagent",
    }).inject();
    expect(sub.skillCatalog?.source.entries.map((e) => e.name).sort()).toEqual([
      "proj",
      "seeded",
    ]);
  });

  it("subagent still injects home convention including ~/.claude and ~/.agents", async () => {
    const root = await tmp("xrk-conv-");
    const home = await tmp("xrk-convh-");
    await mkdir(path.join(home, ".claude"), { recursive: true });
    await writeFile(
      path.join(home, ".claude", "CLAUDE.md"),
      "HOME_CLAUDE",
      "utf8",
    );
    await mkdir(path.join(home, ".agents"), { recursive: true });
    await writeFile(
      path.join(home, ".agents", "AGENTS.md"),
      "HOME_AGENTS_CONV",
      "utf8",
    );
    await mkdir(path.join(home, ".xrk"), { recursive: true });
    await writeFile(
      path.join(home, ".xrk", "AGENTS.md"),
      "PRODUCT_STANDING",
      "utf8",
    );
    const sub = (
      await createWorkspaceInjector({
        root,
        homeDir: home,
        audience: "subagent",
      }).inject()
    ).instructionBlocks.join("\n");
    expect(sub).toContain("PRODUCT_STANDING");
    expect(sub).toContain("HOME_AGENTS_CONV");
    expect(sub).toContain("HOME_CLAUDE");
  });
});
