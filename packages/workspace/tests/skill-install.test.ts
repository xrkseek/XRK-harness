import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  installSkill,
  installSkillFromGit,
  installSkillFromLocalDir,
  isGitSkillSpec,
  listInstalledSkills,
  removeInstalledSkill,
  resolveInstalledSkillsRoot,
  SkillInstallError,
  WORKSPACE_SKILLS_REL_DIR,
} from "../src/index.js";

/** Well-formed skill frontmatter (mirrors `skills.test.ts`). */
function skillMarkdown(name: string, description: string): string {
  return `---
name: ${name}
description: ${description}
---
# ${name}

Body text.
`;
}

async function tempDir(prefix: string): Promise<string> {
  return mkdtemp(path.join(tmpdir(), prefix));
}

/** Write a valid `<root>/<name>/SKILL.md` and return the skill directory. */
async function makeSkillDir(
  root: string,
  name: string,
  description = `${name} skill`,
): Promise<string> {
  const dir = path.join(root, name);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "SKILL.md"), skillMarkdown(name, description), "utf8");
  return dir;
}

function hasGit(): boolean {
  try {
    return (spawnSync("git", ["--version"]).status ?? 1) === 0;
  } catch {
    return false;
  }
}

const GIT_AVAILABLE = hasGit();

describe("installSkillFromLocalDir", () => {
  it("installs a local skill directory under .agents/skills", async () => {
    const ws = await tempDir("xrk-skill-ws-");
    const src = await tempDir("xrk-skill-src-");
    const skillDir = await makeSkillDir(src, "office-ping", "Ping skill");

    const res = installSkillFromLocalDir(skillDir, { workspaceRoot: ws });

    expect(res.name).toBe("office-ping");
    expect(res.source).toBe("local");
    expect(res.url).toBeUndefined();
    expect(res.directory).toBe(path.join(ws, WORKSPACE_SKILLS_REL_DIR, "office-ping"));
    expect(existsSync(path.join(res.directory, "SKILL.md"))).toBe(true);
    expect(await readFile(path.join(res.directory, "SKILL.md"), "utf8")).toContain(
      "office-ping",
    );
  });

  it("accepts a file: prefix and a #subdir within a collection", async () => {
    const ws = await tempDir("xrk-skill-ws-");
    const src = await tempDir("xrk-skill-coll-");
    await makeSkillDir(src, "alpha");
    await makeSkillDir(src, "beta");

    const res = installSkillFromLocalDir(`file:${src}#beta`, { workspaceRoot: ws });

    expect(res.name).toBe("beta");
    expect(existsSync(path.join(res.directory, "SKILL.md"))).toBe(true);
  });

  it("resolves a relative --dir against the workspace root", async () => {
    const ws = await tempDir("xrk-skill-ws-");
    const src = await tempDir("xrk-skill-src-");
    const skillDir = await makeSkillDir(src, "custom-root");

    const res = installSkillFromLocalDir(skillDir, {
      workspaceRoot: ws,
      skillsRoot: "vendor/skills",
    });

    expect(res.directory).toBe(path.join(ws, "vendor", "skills", "custom-root"));
  });

  it("fails closed when the source directory is missing", async () => {
    const ws = await tempDir("xrk-skill-ws-");
    expect(() =>
      installSkillFromLocalDir(path.join(ws, "nope"), { workspaceRoot: ws }),
    ).toThrow(SkillInstallError);
    expect(() =>
      installSkillFromLocalDir(path.join(ws, "nope"), { workspaceRoot: ws }),
    ).toThrow(/not found/);
  });

  it("fails closed when no SKILL.md is present", async () => {
    const ws = await tempDir("xrk-skill-ws-");
    const src = await tempDir("xrk-skill-src-");
    const bare = path.join(src, "not-a-skill");
    await mkdir(bare, { recursive: true });
    await writeFile(path.join(bare, "README.md"), "no frontmatter", "utf8");

    expect(() => installSkillFromLocalDir(bare, { workspaceRoot: ws })).toThrow(
      /no SKILL\.md/,
    );
  });

  it("rejects invalid frontmatter rather than copying it", async () => {
    const ws = await tempDir("xrk-skill-ws-");
    const src = await tempDir("xrk-skill-src-");
    const dir = path.join(src, "bad-bool");
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, "SKILL.md"),
      `---
name: bad-bool
description: invalid user-invocable
user-invocable: maybe
---
Body.
`,
      "utf8",
    );

    expect(() => installSkillFromLocalDir(dir, { workspaceRoot: ws })).toThrow(
      /invalid/,
    );
    expect(existsSync(path.join(ws, WORKSPACE_SKILLS_REL_DIR, "bad-bool"))).toBe(false);
  });

  it("rejects a path-like skill name from frontmatter", async () => {
    const ws = await tempDir("xrk-skill-ws-");
    const src = await tempDir("xrk-skill-src-");
    const dir = path.join(src, "traverse");
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, "SKILL.md"),
      `---
name: ../escape
description: tries to escape
---
Body.
`,
      "utf8",
    );

    expect(() => installSkillFromLocalDir(dir, { workspaceRoot: ws })).toThrow(
      SkillInstallError,
    );
    expect(() => installSkillFromLocalDir(dir, { workspaceRoot: ws })).toThrow(
      /invalid skill name/,
    );
    expect(existsSync(path.join(ws, "escape"))).toBe(false);
  });

  it("refuses to overwrite an existing skill unless force is set", async () => {
    const ws = await tempDir("xrk-skill-ws-");
    const src = await tempDir("xrk-skill-src-");
    const skillDir = await makeSkillDir(src, "dup", "first");

    installSkillFromLocalDir(skillDir, { workspaceRoot: ws });
    expect(() => installSkillFromLocalDir(skillDir, { workspaceRoot: ws })).toThrow(
      /already exists/,
    );

    // Change the source, then force-overwrite.
    await writeFile(
      path.join(skillDir, "SKILL.md"),
      skillMarkdown("dup", "second"),
      "utf8",
    );
    const res = installSkillFromLocalDir(skillDir, {
      workspaceRoot: ws,
      force: true,
    });
    expect(await readFile(path.join(res.directory, "SKILL.md"), "utf8")).toContain(
      "second",
    );
  });

  it("rejects a #subdir that escapes the source tree", async () => {
    const ws = await tempDir("xrk-skill-ws-");
    const src = await tempDir("xrk-skill-src-");
    await makeSkillDir(src, "inner");

    expect(() =>
      installSkillFromLocalDir(`${src}#../outside`, { workspaceRoot: ws }),
    ).toThrow(SkillInstallError);
  });
});

describe("installSkill dispatcher", () => {
  it("routes a plain path to the local installer", async () => {
    const ws = await tempDir("xrk-skill-ws-");
    const src = await tempDir("xrk-skill-src-");
    const skillDir = await makeSkillDir(src, "local-route");

    const res = installSkill(skillDir, { workspaceRoot: ws });
    expect(res.source).toBe("local");
    expect(res.name).toBe("local-route");
  });

  it("detects git-shaped specs", () => {
    expect(isGitSkillSpec("github:acme/skills")).toBe(true);
    expect(isGitSkillSpec("git:https://example.com/x.git")).toBe(true);
    expect(isGitSkillSpec("git+https://example.com/x.git")).toBe(true);
    expect(isGitSkillSpec("https://example.com/x.git")).toBe(true);
    expect(isGitSkillSpec("git@github.com:acme/skills.git")).toBe(true);
    expect(isGitSkillSpec("./local/path")).toBe(false);
    expect(isGitSkillSpec("file:./local")).toBe(false);
  });
});

describe("listInstalledSkills / removeInstalledSkill", () => {
  it("lists installed skills with their descriptions", async () => {
    const ws = await tempDir("xrk-skill-ws-");
    const src = await tempDir("xrk-skill-src-");
    await makeSkillDir(src, "alpha", "Alpha description");
    await makeSkillDir(src, "beta", "Beta description");

    installSkillFromLocalDir(path.join(src, "alpha"), { workspaceRoot: ws });
    installSkillFromLocalDir(path.join(src, "beta"), { workspaceRoot: ws });

    const listed = listInstalledSkills({ workspaceRoot: ws });
    expect(listed.map((s) => s.name)).toEqual(["alpha", "beta"]);
    expect(listed[0]?.description).toBe("Alpha description");
  });

  it("returns an empty list when the skills root is absent", async () => {
    const ws = await tempDir("xrk-skill-ws-");
    expect(listInstalledSkills({ workspaceRoot: ws })).toEqual([]);
  });

  it("removes an installed skill and reports a second miss", async () => {
    const ws = await tempDir("xrk-skill-ws-");
    const src = await tempDir("xrk-skill-src-");
    await makeSkillDir(src, "gone");

    installSkillFromLocalDir(path.join(src, "gone"), { workspaceRoot: ws });
    expect(removeInstalledSkill("gone", { workspaceRoot: ws })).toBe(true);
    expect(removeInstalledSkill("gone", { workspaceRoot: ws })).toBe(false);
  });

  it("rejects a path-like name on remove", async () => {
    const ws = await tempDir("xrk-skill-ws-");
    expect(() => removeInstalledSkill("../escape", { workspaceRoot: ws })).toThrow(
      /invalid skill name/,
    );
  });
});

describe("resolveInstalledSkillsRoot", () => {
  it("defaults to .agents/skills under the workspace", async () => {
    const ws = await tempDir("xrk-skill-ws-");
    expect(resolveInstalledSkillsRoot({ workspaceRoot: ws })).toBe(
      path.join(ws, WORKSPACE_SKILLS_REL_DIR),
    );
  });

  it("honors XRK_SKILLS_DIR (absolute and relative)", async () => {
    const ws = await tempDir("xrk-skill-ws-");
    const abs = await tempDir("xrk-skill-abs-");
    expect(
      resolveInstalledSkillsRoot({
        workspaceRoot: ws,
        env: { XRK_SKILLS_DIR: abs },
      }),
    ).toBe(path.resolve(abs));
    expect(
      resolveInstalledSkillsRoot({
        workspaceRoot: ws,
        env: { XRK_SKILLS_DIR: "env/skills" },
      }),
    ).toBe(path.join(ws, "env", "skills"));
  });

  it("prefers an explicit skillsRoot over the env default", async () => {
    const ws = await tempDir("xrk-skill-ws-");
    expect(
      resolveInstalledSkillsRoot({
        workspaceRoot: ws,
        skillsRoot: "explicit",
        env: { XRK_SKILLS_DIR: "env/skills" },
      }),
    ).toBe(path.join(ws, "explicit"));
  });
});

describe.skipIf(!GIT_AVAILABLE)("installSkillFromGit", () => {
  async function initRepoWithSkill(dir: string, name: string): Promise<string> {
    await mkdir(dir, { recursive: true });
    await makeSkillDir(dir, name);
    const git = (args: readonly string[]) =>
      spawnSync("git", args, { cwd: dir, encoding: "utf8" });
    git(["init"]);
    git(["config", "user.email", "test@example.com"]);
    git(["config", "user.name", "Test"]);
    git(["add", "-A"]);
    git(["commit", "-m", "add skill"]);
    return dir;
  }

  it("clones a repository holding exactly one skill", async () => {
    const ws = await tempDir("xrk-skill-ws-");
    const repo = await initRepoWithSkill(await tempDir("xrk-skill-repo-"), "git-skill");
    const spec = `git+${pathToFileURL(repo).href}`;

    const res = installSkillFromGit(spec, { workspaceRoot: ws });
    expect(res.source).toBe("git");
    expect(res.name).toBe("git-skill");
    expect(res.url).toBe(pathToFileURL(repo).href);
    expect(existsSync(path.join(res.directory, "SKILL.md"))).toBe(true);
  });

  it("surfaces a clear error when the clone target does not exist", async () => {
    const ws = await tempDir("xrk-skill-ws-");
    const missing = `git+${
      pathToFileURL(path.join(tmpdir(), `xrk-missing-${Date.now()}.git`)).href
    }`;
    expect(() => installSkillFromGit(missing, { workspaceRoot: ws })).toThrow(
      SkillInstallError,
    );
    expect(() => installSkillFromGit(missing, { workspaceRoot: ws })).toThrow(
      /git clone failed/,
    );
  });
});
