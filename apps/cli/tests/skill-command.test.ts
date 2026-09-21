import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";
import { runSkill, skillHelpText } from "../src/commands/skill.js";

const temps: string[] = [];
let outSpy: MockInstance;
let errSpy: MockInstance;

function tempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

/** Collect everything written to a spied stream since the last `clear`. */
function written(spy: MockInstance): string {
  return spy.mock.calls.map((c) => String(c[0])).join("");
}

function stdout(): string {
  return written(outSpy);
}

function stderr(): string {
  return written(errSpy);
}

function clear(): void {
  outSpy.mockClear();
  errSpy.mockClear();
}

beforeEach(() => {
  // Silence both streams for every test so nothing leaks to the runner.
  outSpy = vi.spyOn(process.stdout, "write").mockImplementation((() => true) as never);
  errSpy = vi.spyOn(process.stderr, "write").mockImplementation((() => true) as never);
});

afterEach(() => {
  for (const d of temps.splice(0)) {
    rmSync(d, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

function writeSkill(root: string, name: string, description = `${name} skill`): string {
  const dir = path.join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n---\n# ${name}\n\nBody.\n`,
    "utf8",
  );
  return dir;
}

describe("runSkill", () => {
  it("adds a local skill and reports the install target", async () => {
    const ws = tempDir("xrk-cli-skill-ws-");
    const src = tempDir("xrk-cli-skill-src-");
    const skillDir = writeSkill(src, "office-ping", "Ping skill");

    const code = await runSkill(["add", skillDir, "--workspace", ws]);

    expect(code).toBe(0);
    expect(stdout()).toContain("installed office-ping");
    expect(
      existsSync(path.join(ws, ".agents", "skills", "office-ping", "SKILL.md")),
    ).toBe(true);
  });

  it("lists installed skills as JSON", async () => {
    const ws = tempDir("xrk-cli-skill-ws-");
    const src = tempDir("xrk-cli-skill-src-");
    await runSkill([
      "add",
      writeSkill(src, "listed", "Listed description"),
      "--workspace",
      ws,
    ]);

    clear();
    const code = await runSkill(["list", "--json", "--workspace", ws]);

    expect(code).toBe(0);
    const parsed = JSON.parse(stdout().trim()) as {
      root: string;
      skills: readonly { name: string; description: string }[];
    };
    expect(parsed.root).toBe(path.join(ws, ".agents", "skills"));
    expect(parsed.skills.map((s) => s.name)).toEqual(["listed"]);
    expect(parsed.skills[0]?.description).toBe("Listed description");
  });

  it("prints (none) when the skills root is still empty", async () => {
    const ws = tempDir("xrk-cli-skill-ws-");
    expect(await runSkill(["list", "--workspace", ws])).toBe(0);
    expect(stdout()).toContain("(none)");
    expect(stdout()).toContain(path.join(ws, ".agents", "skills"));
  });

  it("prints the resolved skills root via `path`", async () => {
    const ws = tempDir("xrk-cli-skill-ws-");
    expect(await runSkill(["path", "--workspace", ws])).toBe(0);
    expect(stdout().trim()).toBe(path.join(ws, ".agents", "skills"));
  });

  it("removes a skill, then reports the second attempt as missing", async () => {
    const ws = tempDir("xrk-cli-skill-ws-");
    const src = tempDir("xrk-cli-skill-src-");
    await runSkill(["add", writeSkill(src, "gone"), "--workspace", ws]);

    clear();
    expect(await runSkill(["remove", "gone", "--workspace", ws])).toBe(0);
    expect(stdout()).toContain("removed gone");

    clear();
    expect(await runSkill(["rm", "gone", "--workspace", ws])).toBe(0);
    expect(stdout()).toContain("missing gone");
  });

  it("honors --force to overwrite an existing skill", async () => {
    const ws = tempDir("xrk-cli-skill-ws-");
    const src = tempDir("xrk-cli-skill-src-");
    const skillDir = writeSkill(src, "dup", "first");
    await runSkill(["add", skillDir, "--workspace", ws]);

    clear();
    expect(await runSkill(["add", skillDir, "--workspace", ws])).toBe(1);
    expect(stderr()).toContain("already exists");

    clear();
    expect(await runSkill(["add", skillDir, "--force", "--workspace", ws])).toBe(0);
  });

  it("respects a --dir override", async () => {
    const ws = tempDir("xrk-cli-skill-ws-");
    const src = tempDir("xrk-cli-skill-src-");
    const skillDir = writeSkill(src, "overridden");

    const code = await runSkill([
      "add",
      skillDir,
      "--workspace",
      ws,
      "--dir",
      "vendor/skills",
    ]);

    expect(code).toBe(0);
    expect(
      existsSync(path.join(ws, "vendor", "skills", "overridden", "SKILL.md")),
    ).toBe(true);
  });

  it("fails with a clear error for an unknown subcommand", async () => {
    const ws = tempDir("xrk-cli-skill-ws-");
    expect(await runSkill(["bogus", "--workspace", ws])).toBe(1);
    expect(stderr()).toContain("unknown skill subcommand: bogus");
  });

  it("requires at least one spec for add / remove", async () => {
    const ws = tempDir("xrk-cli-skill-ws-");
    expect(await runSkill(["add", "--workspace", ws])).toBe(1);
    expect(stderr()).toContain("needs at least one <spec>");

    clear();
    expect(await runSkill(["remove", "--workspace", ws])).toBe(1);
    expect(stderr()).toContain("needs at least one <name>");
  });

  it("rejects unknown flags and missing flag values", async () => {
    const ws = tempDir("xrk-cli-skill-ws-");
    expect(await runSkill(["list", "--workspace", ws, "--nope"])).toBe(1);
    expect(stderr()).toContain("unknown flag: --nope");

    clear();
    expect(await runSkill(["list", "--dir"])).toBe(1);
    expect(stderr()).toContain("--dir needs a value");
  });

  it("surfaces a SkillInstallError code for a bad local spec", async () => {
    const ws = tempDir("xrk-cli-skill-ws-");
    expect(await runSkill(["add", path.join(ws, "absent"), "--workspace", ws])).toBe(1);
    expect(stderr()).toContain("SKILL_NOT_FOUND");
  });

  it("prints help with no arguments", async () => {
    expect(await runSkill([])).toBe(0);
    expect(stdout()).toContain("xrkh skill —");
    expect(skillHelpText()).toContain("XRK_SKILLS_DIR");
  });
});
