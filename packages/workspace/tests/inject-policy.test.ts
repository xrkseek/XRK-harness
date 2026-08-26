import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { computeInjectFingerprint } from "../src/inject-fingerprint.js";
import {
  HOME_CONVENTION_INJECT,
  SKILL_VENDOR_PRIORITY,
  USER_HOME_SKILL_REL_DIRS,
  WORKSPACE_CONVENTION_INJECT,
  WORKSPACE_SKILL_REL_DIRS,
} from "../src/inject-sources.js";
import { resolveSkillDirs } from "../src/skill-dirs.js";

describe("inject policy (inject-sources)", () => {
  it("home profile excludes cursor and github", () => {
    expect(HOME_CONVENTION_INJECT.cursorRules).toBe(false);
    expect(HOME_CONVENTION_INJECT.github).toBe(false);
    expect(HOME_CONVENTION_INJECT.codexRootMd).toBe(false);
    expect(WORKSPACE_CONVENTION_INJECT.cursorRules).toBe(true);
    expect(WORKSPACE_CONVENTION_INJECT.github).toBe(true);
  });

  it("workspace skill roots lead with .xrk native", () => {
    expect(WORKSPACE_SKILL_REL_DIRS[0]).toBe(".xrk/skills");
    expect(SKILL_VENDOR_PRIORITY[0]).toBe(".xrk/skills");
  });

  it("home skill roots omit .cursor/skills", () => {
    expect(USER_HOME_SKILL_REL_DIRS).not.toContain(".cursor/skills");
    expect(WORKSPACE_SKILL_REL_DIRS).toContain(".cursor/skills");
  });

  it("resolveSkillDirs skips ~/.cursor/skills even when includeUserHome", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "xrk-sk-pol-"));
    const home = path.join(root, "home");
    await mkdir(path.join(home, ".cursor", "skills", "maint"), { recursive: true });
    await mkdir(path.join(home, ".agents", "skills", "global"), { recursive: true });
    await writeFile(
      path.join(home, ".cursor", "skills", "maint", "SKILL.md"),
      "---\ndescription: cursor home\n---\n",
      "utf8",
    );
    await writeFile(
      path.join(home, ".agents", "skills", "global", "SKILL.md"),
      "---\ndescription: agents home\n---\n",
      "utf8",
    );

    const dirs = await resolveSkillDirs({
      workspaceRoot: root,
      homeDir: home,
      includeUserHome: true,
    });
    expect(dirs.some((d) => d.includes(".cursor"))).toBe(false);
    expect(dirs.some((d) => d.includes(".agents"))).toBe(true);
  });

  it("fingerprint ignores home .cursor/rules churn", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "xrk-fp-cursor-"));
    const product = path.join(root, ".xrk");
    const home = path.join(root, "home");
    await mkdir(product, { recursive: true });
    await mkdir(path.join(home, ".cursor", "rules"), { recursive: true });

    const before = await computeInjectFingerprint({
      root,
      productDir: product,
      homeDir: home,
    });
    await writeFile(
      path.join(home, ".cursor", "rules", "maintainer.mdc"),
      "---\ndescription: x\n---\n# Cursor home rule\n",
      "utf8",
    );
    const after = await computeInjectFingerprint({
      root,
      productDir: product,
      homeDir: home,
    });
    expect(after).toBe(before);
  });
});
