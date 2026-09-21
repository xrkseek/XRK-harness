/**
 * Install skills into the workspace from a local directory or a git repo.
 *
 * Mirrors Hermes `skills_hub.py` / `skills_hub_install.py`: skills should be
 * installable, not only hand-copied `SKILL.md` files. Everything is validated
 * fail-closed — a candidate without a parseable `SKILL.md` is rejected, and
 * nothing is ever written outside the target skills root.
 */
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { shouldSkipScanDir } from "./scan-guards.js";
import { isSkillName, parseSkillMarkdown } from "./skills.js";

/** Default workspace skills root (product skill home — see `.agents/`). */
export const WORKSPACE_SKILLS_REL_DIR = ".agents/skills";

export type SkillInstallSourceKind = "local" | "git";

export interface SkillInstallResult {
  readonly name: string;
  readonly directory: string;
  readonly source: SkillInstallSourceKind;
  /** Resolved git URL when `source` is `git`. */
  readonly url?: string;
}

export class SkillInstallError extends Error {
  readonly code: string;

  constructor(message: string, code = "SKILL_INSTALL") {
    super(message);
    this.name = "SkillInstallError";
    this.code = code;
  }
}

export interface SkillInstallOptions {
  /** Workspace root; the skills root resolves under it unless `skillsRoot` is set. */
  readonly workspaceRoot: string;
  /** Override the target skills directory (absolute, or relative to workspace). */
  readonly skillsRoot?: string;
  /** Overwrite an existing skill of the same name. Default false. */
  readonly force?: boolean;
  /** Git ref / branch / tag to clone. */
  readonly ref?: string;
  /** `git` binary. Default `git`. */
  readonly gitBin?: string;
  readonly env?: NodeJS.ProcessEnv;
}

function resolveSkillsRoot(options: SkillInstallOptions): string {
  const env = options.env ?? process.env;
  const configured =
    options.skillsRoot?.trim() ||
    String(env.XRK_SKILLS_DIR ?? "").trim() ||
    WORKSPACE_SKILLS_REL_DIR;
  return path.isAbsolute(configured)
    ? path.resolve(configured)
    : path.resolve(options.workspaceRoot, configured);
}

/**
 * The skills root that install / list / remove operate on. Exposed so CLI
 * surfaces can print the resolved location without re-deriving the
 * `XRK_SKILLS_DIR` default.
 */
export function resolveInstalledSkillsRoot(options: SkillInstallOptions): string {
  return resolveSkillsRoot(options);
}

/** Throw when `child` would land outside `root` (path-traversal guard). */
function assertInside(root: string, child: string): void {
  const absRoot = path.resolve(root);
  const absChild = path.resolve(child);
  const rel = path.relative(absRoot, absChild);
  if (rel === "" || rel === ".") return;
  if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw new SkillInstallError(
      `skill path escapes the skills root: ${child}`,
      "SKILL_PATH",
    );
  }
}

function isDirectory(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Validate a candidate skill directory: it must hold a `SKILL.md` whose
 * frontmatter parses and yields a usable name.
 */
function readValidSkill(dir: string, fallbackName: string): { readonly name: string } {
  const skillFile = path.join(dir, "SKILL.md");
  if (!existsSync(skillFile)) {
    throw new SkillInstallError(
      `not a skill directory (no SKILL.md): ${dir}`,
      "SKILL_INVALID",
    );
  }
  let raw: string;
  try {
    raw = readFileSync(skillFile, "utf8");
  } catch (err) {
    throw new SkillInstallError(
      `cannot read ${skillFile}: ${err instanceof Error ? err.message : String(err)}`,
      "SKILL_INVALID",
    );
  }
  const parsed = parseSkillMarkdown(raw, fallbackName);
  if (parsed.invalid) {
    throw new SkillInstallError(
      `skill frontmatter is invalid in ${skillFile} (fail closed)`,
      "SKILL_INVALID",
    );
  }
  const name = parsed.name.trim() || fallbackName;
  if (!isSkillName(name)) {
    throw new SkillInstallError(
      `invalid skill name "${name}" (from ${skillFile})`,
      "SKILL_NAME",
    );
  }
  return { name };
}

/** Install a validated skill directory into the workspace skills root. */
function publishSkill(
  sourceDir: string,
  fallbackName: string,
  options: SkillInstallOptions,
  source: SkillInstallSourceKind,
  url?: string,
): SkillInstallResult {
  const skillsRoot = resolveSkillsRoot(options);
  const { name } = readValidSkill(sourceDir, fallbackName);

  const target = path.join(skillsRoot, name);
  assertInside(skillsRoot, target);

  const srcAbs = path.resolve(sourceDir);
  if (srcAbs === path.resolve(target)) {
    throw new SkillInstallError(
      `skill "${name}" is already at ${target}`,
      "SKILL_EXISTS",
    );
  }
  // Copying a directory into itself would recurse forever.
  if (path.resolve(target).startsWith(`${srcAbs}${path.sep}`)) {
    throw new SkillInstallError(
      `refusing to install a skill into its own source tree: ${target}`,
      "SKILL_PATH",
    );
  }

  if (existsSync(target) && options.force !== true) {
    throw new SkillInstallError(
      `skill "${name}" already exists at ${target} (use force to overwrite)`,
      "SKILL_EXISTS",
    );
  }

  mkdirSync(skillsRoot, { recursive: true });
  if (existsSync(target)) rmSync(target, { recursive: true, force: true });
  cpSync(sourceDir, target, { recursive: true });

  return {
    name,
    directory: target,
    source,
    ...(url !== undefined ? { url } : {}),
  };
}

/** Find every directory containing `SKILL.md`, breadth-first and bounded. */
function findSkillDirs(root: string, maxDepth = 4): readonly string[] {
  const found: string[] = [];
  const walk = (dir: string, depth: number): void => {
    if (existsSync(path.join(dir, "SKILL.md"))) found.push(dir);
    if (depth >= maxDepth) return;
    let entries: readonly string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (shouldSkipScanDir(entry)) continue;
      const child = path.join(dir, entry);
      if (isDirectory(child)) walk(child, depth + 1);
    }
  };
  walk(root, 0);
  return found;
}

/** Pick the one skill directory inside a checkout, or explain the ambiguity. */
function locateSkillDir(cloneRoot: string, subdir?: string): string {
  if (subdir) {
    const target = path.resolve(cloneRoot, subdir);
    assertInside(cloneRoot, target);
    if (!isDirectory(target)) {
      throw new SkillInstallError(
        `subdirectory not found in repository: ${subdir}`,
        "SKILL_NOT_FOUND",
      );
    }
    return target;
  }
  if (existsSync(path.join(cloneRoot, "SKILL.md"))) return cloneRoot;

  // Convention: a `skills/` folder holding one directory per skill.
  const skillsDir = path.join(cloneRoot, "skills");
  const searchRoot = isDirectory(skillsDir) ? skillsDir : cloneRoot;

  const candidates = findSkillDirs(searchRoot).filter(
    (dir) => path.resolve(dir) !== path.resolve(cloneRoot),
  );
  if (candidates.length === 0) {
    throw new SkillInstallError(`no SKILL.md found in ${cloneRoot}`, "SKILL_NOT_FOUND");
  }
  if (candidates.length > 1) {
    const rel = candidates
      .map((c) => path.relative(cloneRoot, c) || ".")
      .map((r) => r.split(path.sep).join("/"))
      .sort();
    throw new SkillInstallError(
      `repository contains ${candidates.length} skills; pass a #subdir — ` +
        `candidates: ${rel.join(", ")}`,
      "SKILL_AMBIGUOUS",
    );
  }
  return candidates[0]!;
}

/**
 * Install from a local directory. `spec` may be a plain path, or
 * `file:`/`link:` prefixed, optionally with a `#subdir` fragment when the
 * directory is a collection.
 */
export function installSkillFromLocalDir(
  spec: string,
  options: SkillInstallOptions,
): SkillInstallResult {
  const { target: specPath, subdir } = splitSpec(spec);
  const bare = specPath.startsWith("file:")
    ? specPath.slice("file:".length)
    : specPath.startsWith("link:")
      ? specPath.slice("link:".length)
      : specPath;
  if (!bare.trim()) {
    throw new SkillInstallError("local skill spec is empty", "SKILL_SPEC");
  }
  const sourceDir = path.resolve(bare);
  if (!isDirectory(sourceDir)) {
    throw new SkillInstallError(
      `local skill directory not found: ${sourceDir}`,
      "SKILL_NOT_FOUND",
    );
  }
  const resolved = subdir
    ? (() => {
        const target = path.resolve(sourceDir, subdir);
        assertInside(sourceDir, target);
        if (!isDirectory(target)) {
          throw new SkillInstallError(
            `subdirectory not found: ${subdir}`,
            "SKILL_NOT_FOUND",
          );
        }
        return target;
      })()
    : sourceDir;

  return publishSkill(resolved, path.basename(resolved), options, "local");
}

interface GitSpec {
  readonly url: string;
  readonly subdir?: string;
}

function parseGitSpec(url: string, subdir?: string): GitSpec {
  if (url.startsWith("github:")) {
    const rest = url.slice("github:".length).trim();
    if (!rest) {
      throw new SkillInstallError("github: spec needs owner/repo", "SKILL_SPEC");
    }
    return {
      url: `https://github.com/${rest}.git`,
      ...(subdir !== undefined ? { subdir } : {}),
    };
  }
  if (url.startsWith("git+")) {
    return {
      url: url.slice("git+".length),
      ...(subdir !== undefined ? { subdir } : {}),
    };
  }
  return { url, ...(subdir !== undefined ? { subdir } : {}) };
}

/**
 * Install from a git repository (`git:` / `github:` / `git+` / https / ssh).
 * `#subdir` selects one skill when the repository holds several.
 */
export function installSkillFromGit(
  spec: string,
  options: SkillInstallOptions,
): SkillInstallResult {
  const { target: rawUrl, subdir } = splitSpec(spec);
  if (rawUrl.startsWith("git:")) {
    const rest = rawUrl.slice("git:".length).trim();
    const parsed = parseGitSpec(rest, subdir);
    return cloneAndPublish(parsed, options);
  }
  return cloneAndPublish(parseGitSpec(rawUrl, subdir), options);
}

function cloneAndPublish(
  spec: GitSpec,
  options: SkillInstallOptions,
): SkillInstallResult {
  if (!spec.url.trim()) {
    throw new SkillInstallError("git skill spec is empty", "SKILL_SPEC");
  }
  const gitBin = options.gitBin?.trim() || "git";
  const stage = mkdtempSync(path.join(tmpdir(), "xrk-skill-clone-"));
  try {
    const argv = [
      "clone",
      "--depth",
      "1",
      ...(options.ref?.trim() ? ["--branch", options.ref.trim()] : []),
      spec.url,
      stage,
    ];
    const result = spawnSync(gitBin, argv, {
      encoding: "utf8",
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    if ((result.status ?? 1) !== 0) {
      const detail = (
        result.stderr ||
        result.stdout ||
        result.error?.message ||
        ""
      ).trim();
      throw new SkillInstallError(
        `git clone failed for ${spec.url}: ${detail || "unknown error"}`,
        "SKILL_GIT",
      );
    }
    const skillDir = locateSkillDir(stage, spec.subdir);
    return publishSkill(skillDir, path.basename(skillDir), options, "git", spec.url);
  } finally {
    try {
      rmSync(stage, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

/** Split a `path#subdir` spec (subdir uses `/`, never absolute). */
function splitSpec(spec: string): {
  readonly target: string;
  readonly subdir?: string;
} {
  const raw = spec.trim();
  if (!raw) {
    throw new SkillInstallError("skill spec is empty", "SKILL_SPEC");
  }
  const hash = raw.indexOf("#");
  if (hash < 0) return { target: raw };
  const target = raw.slice(0, hash);
  const subdir = raw.slice(hash + 1).trim();
  if (!target) {
    throw new SkillInstallError(`invalid skill spec: ${spec}`, "SKILL_SPEC");
  }
  if (!subdir) return { target };
  if (subdir.startsWith("/") || subdir.startsWith("\\") || /^[A-Za-z]:/.test(subdir)) {
    throw new SkillInstallError(
      `#subdir must be repository-relative: ${subdir}`,
      "SKILL_PATH",
    );
  }
  return { target, subdir };
}

const GIT_URL_RE = /^(?:git:|git\+|github:|https?:\/\/|ssh:\/\/|git@)/i;

/** True when the spec points at a git repository rather than a local path. */
export function isGitSkillSpec(spec: string): boolean {
  return GIT_URL_RE.test(spec.trim());
}

/**
 * Install a skill from either a local directory or a git repository.
 * Git specs are detected by prefix / URL shape.
 */
export function installSkill(
  spec: string,
  options: SkillInstallOptions,
): SkillInstallResult {
  return isGitSkillSpec(spec)
    ? installSkillFromGit(spec, options)
    : installSkillFromLocalDir(spec, options);
}

/** Remove an installed skill by name. Returns false when it was absent. */
export function removeInstalledSkill(
  name: string,
  options: SkillInstallOptions,
): boolean {
  if (!isSkillName(name)) {
    throw new SkillInstallError(`invalid skill name "${name}"`, "SKILL_NAME");
  }
  const skillsRoot = resolveSkillsRoot(options);
  const target = path.join(skillsRoot, name);
  assertInside(skillsRoot, target);
  if (!existsSync(target)) return false;
  rmSync(target, { recursive: true, force: true });
  return true;
}

export interface InstalledSkillInfo {
  readonly name: string;
  readonly directory: string;
  readonly description: string;
}

/** List skills currently installed in the workspace skills root. */
export function listInstalledSkills(
  options: SkillInstallOptions,
): readonly InstalledSkillInfo[] {
  const skillsRoot = resolveSkillsRoot(options);
  if (!isDirectory(skillsRoot)) return [];
  const out: InstalledSkillInfo[] = [];
  for (const entry of readdirSync(skillsRoot).sort()) {
    if (shouldSkipScanDir(entry)) continue;
    const dir = path.join(skillsRoot, entry);
    if (!isDirectory(dir)) continue;
    const skillFile = path.join(dir, "SKILL.md");
    if (!existsSync(skillFile)) continue;
    let description = "";
    try {
      description = parseSkillMarkdown(
        readFileSync(skillFile, "utf8"),
        entry,
      ).description;
    } catch {
      /* keep empty description */
    }
    out.push({ name: entry, directory: dir, description });
  }
  return out;
}
