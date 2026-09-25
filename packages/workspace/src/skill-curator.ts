/**
 * Deterministic skill curator (Hermes curator spirit, no aux LLM).
 * Archives workspace skills whose SKILL.md mtime is older than `staleAfterDays`.
 * Never deletes — moves to `{skillsRoot}/.archive/`. Hub / pin paths stay untouched.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import path from "node:path";
import { listSkillsInDir } from "./skills.js";
import { WORKSPACE_SKILLS_REL_DIR } from "./skill-install.js";

export const SKILL_ARCHIVE_REL = ".archive";
export const DEFAULT_SKILL_STALE_AFTER_DAYS = 90;

export interface SkillCuratorOptions {
  readonly workspaceRoot: string;
  /** Absolute or workspace-relative skills root. Default `.agents/skills`. */
  readonly skillsRoot?: string;
  /** Archive when SKILL.md mtime older than this many days. Default 90. */
  readonly staleAfterDays?: number;
  /** Skill dir names that must never archive. */
  readonly pinned?: readonly string[];
  /** When true, only report candidates. */
  readonly dryRun?: boolean;
  readonly now?: () => number;
}

export interface SkillCuratorCandidate {
  readonly name: string;
  readonly directory: string;
  readonly mtimeMs: number;
  readonly ageDays: number;
}

export interface SkillCuratorResult {
  readonly skillsRoot: string;
  readonly archiveRoot: string;
  readonly candidates: readonly SkillCuratorCandidate[];
  readonly archived: readonly string[];
  readonly skippedPinned: readonly string[];
  readonly dryRun: boolean;
}

function resolveSkillsRoot(
  workspaceRoot: string,
  skillsRoot?: string,
): string {
  const configured = skillsRoot?.trim() || WORKSPACE_SKILLS_REL_DIR;
  return path.isAbsolute(configured)
    ? path.resolve(configured)
    : path.resolve(workspaceRoot, configured);
}

function ageDays(mtimeMs: number, nowMs: number): number {
  return (nowMs - mtimeMs) / (24 * 60 * 60 * 1000);
}

/**
 * List / optionally archive stale agent-authored skills under the workspace
 * skills root. Bundled seed skills outside this root are never touched.
 */
export async function runSkillCurator(
  options: SkillCuratorOptions,
): Promise<SkillCuratorResult> {
  const skillsRoot = resolveSkillsRoot(
    options.workspaceRoot,
    options.skillsRoot,
  );
  const archiveRoot = path.join(skillsRoot, SKILL_ARCHIVE_REL);
  const staleAfterDays =
    options.staleAfterDays ?? DEFAULT_SKILL_STALE_AFTER_DAYS;
  const nowMs = (options.now ?? Date.now)();
  const pinned = new Set(
    (options.pinned ?? []).map((n) => n.trim()).filter(Boolean),
  );
  const dryRun = options.dryRun === true;

  const candidates: SkillCuratorCandidate[] = [];
  const skippedPinned: string[] = [];
  const archived: string[] = [];

  if (!existsSync(skillsRoot)) {
    return {
      skillsRoot,
      archiveRoot,
      candidates,
      archived,
      skippedPinned,
      dryRun,
    };
  }

  const listed = await listSkillsInDir(skillsRoot);
  for (const skill of listed) {
    if (skill.dirName === SKILL_ARCHIVE_REL) continue;
    if (pinned.has(skill.name) || pinned.has(skill.dirName)) {
      skippedPinned.push(skill.name);
      continue;
    }
    const skillMd = path.join(skill.directory, "SKILL.md");
    if (!existsSync(skillMd)) continue;
    const mtimeMs = statSync(skillMd).mtimeMs;
    const age = ageDays(mtimeMs, nowMs);
    if (age < staleAfterDays) continue;
    candidates.push({
      name: skill.name,
      directory: skill.directory,
      mtimeMs,
      ageDays: Math.floor(age),
    });
  }

  if (!dryRun && candidates.length > 0) {
    mkdirSync(archiveRoot, { recursive: true });
    for (const row of candidates) {
      const dest = path.join(archiveRoot, path.basename(row.directory));
      if (existsSync(dest)) {
        rmSync(dest, { recursive: true, force: true });
      }
      renameSync(row.directory, dest);
      archived.push(row.name);
    }
    const stamp = path.join(archiveRoot, "curator-last-run.json");
    writeFileSync(
      stamp,
      JSON.stringify(
        {
          at: new Date(nowMs).toISOString(),
          archived,
          staleAfterDays,
        },
        null,
        2,
      ),
      "utf8",
    );
  }

  return {
    skillsRoot,
    archiveRoot,
    candidates,
    archived: dryRun ? [] : archived,
    skippedPinned,
    dryRun,
  };
}

/** Read last curator stamp if present (best-effort). */
export function readSkillCuratorStamp(
  skillsRoot: string,
): { at?: string; archived?: string[] } | undefined {
  const stamp = path.join(skillsRoot, SKILL_ARCHIVE_REL, "curator-last-run.json");
  if (!existsSync(stamp)) return undefined;
  try {
    return JSON.parse(readFileSync(stamp, "utf8")) as {
      at?: string;
      archived?: string[];
    };
  } catch {
    return undefined;
  }
}

/** List archived skill directory names under `.archive`. */
export function listArchivedSkillDirs(skillsRoot: string): readonly string[] {
  const archiveRoot = path.join(skillsRoot, SKILL_ARCHIVE_REL);
  if (!existsSync(archiveRoot)) return [];
  return readdirSync(archiveRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
}
