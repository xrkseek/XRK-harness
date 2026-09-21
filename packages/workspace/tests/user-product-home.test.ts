import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  collectEcosystemInstructions,
  sectionsToInstructionBlocks,
} from "../src/ecosystem-instructions.js";
import { computeInjectFingerprint } from "../src/inject-fingerprint.js";
import { resolveSkillDirs } from "../src/skill-dirs.js";
import {
  resolveUnderUserProductHome,
  resolveUserProductHome,
  userProductHomeLogicalPrefix,
} from "../src/user-product-home.js";

describe("user-product-home", () => {
  const prev = {
    XRK_HOME: process.env.XRK_HOME,
    XRK_DSH_HOME: process.env.XRK_DSH_HOME,
    DSH_HOME: process.env.DSH_HOME,
  };

  afterEach(() => {
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("homeDir override maps to {homeDir}/.xrk", () => {
    const home = path.join(tmpdir(), "fake-os-home");
    expect(resolveUserProductHome(home)).toBe(
      path.resolve(path.join(home, ".xrk")),
    );
    expect(userProductHomeLogicalPrefix(home)).toBe("~/.xrk/");
    expect(resolveUnderUserProductHome(".xrk/skills", home)).toBe(
      path.join(path.resolve(home, ".xrk"), "skills"),
    );
  });

  it("honors XRK_HOME when homeDir is unset", () => {
    delete process.env.XRK_DSH_HOME;
    delete process.env.DSH_HOME;
    process.env.XRK_HOME = path.join(tmpdir(), "xrk-custom-home");
    expect(resolveUserProductHome()).toBe(
      path.resolve(process.env.XRK_HOME),
    );
    expect(userProductHomeLogicalPrefix()).toBe("$XRK_HOME/");
  });

  it("inject / skills / fingerprint follow XRK_HOME product root", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "xrk-home-unify-"));
    const productEnv = path.join(root, "env-xrk");
    await mkdir(path.join(productEnv, "skills", "from-env"), {
      recursive: true,
    });
    await writeFile(
      path.join(productEnv, "AGENTS.md"),
      "# Env product standing\n",
      "utf8",
    );
    await writeFile(
      path.join(productEnv, "skills", "from-env", "SKILL.md"),
      "---\ndescription: env skill\n---\n",
      "utf8",
    );

    delete process.env.XRK_DSH_HOME;
    delete process.env.DSH_HOME;
    process.env.XRK_HOME = productEnv;

    const dirs = await resolveSkillDirs({
      workspaceRoot: root,
      includeUserHome: true,
    });
    expect(dirs).toContain(path.join(productEnv, "skills"));

    const sections = await collectEcosystemInstructions({
      root,
      productDir: path.join(root, ".xrk"),
      budget: { left: 32_000, items: [] },
      includeUserHome: true,
    });
    const joined = sectionsToInstructionBlocks(sections).join("\n");
    expect(joined).toContain("Env product standing");
    expect(joined).toContain("## $XRK_HOME/AGENTS.md");

    const before = await computeInjectFingerprint({
      root,
      productDir: path.join(root, ".xrk"),
      includeUserHome: true,
    });
    await writeFile(
      path.join(productEnv, "AGENTS.md"),
      "# Env product standing v2\n",
      "utf8",
    );
    const after = await computeInjectFingerprint({
      root,
      productDir: path.join(root, ".xrk"),
      includeUserHome: true,
    });
    expect(after).not.toBe(before);
  });
});
