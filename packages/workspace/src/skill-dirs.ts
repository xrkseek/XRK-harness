import { access, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { shouldSkipScanDir } from "./scan-guards.js";

/** Shared skill-source options (DSH / Codex multi-root). */
export interface SkillDirSourceOptions {
  readonly workspaceRoot?: string;
  readonly productDir?: string;
  readonly skillDirs?: readonly string[];
  readonly includeUserHome?: boolean;
  readonly homeDir?: string;
}

/**
 * Relative project skill roots, low → high priority (later wins on name clash).
 * Matches Cursor/Claude/Codex layouts; `.xrk/skills` is the XRK-native overlay.
 */
export const PROJECT_SKILL_REL_DIRS = [
  ".codex/skills",
  ".claude/skills",
  ".agents/skills",
  ".cursor/skills",
  ".xrk/skills",
] as const;

/** User-home skill roots (same order; lower than any project root). */
export const USER_SKILL_REL_DIRS = [
  ".codex/skills",
  ".claude/skills",
  ".agents/skills",
  ".cursor/skills",
  ".xrk/skills",
] as const;

const SKILL_DIR_ENTRY_CAP = 512;

async function dirExists(p: string): Promise<boolean> {
  try {
    await access(p);
    const st = await stat(p);
    return st.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Existing skill directories only — never creates paths.
 * Order: user homes (if enabled) → project vendors → optional productDir/skills.
 */
export async function resolveSkillDirs(
  options: SkillDirSourceOptions,
): Promise<readonly string[]> {
  if (options.skillDirs && options.skillDirs.length > 0) {
    const out: string[] = [];
    for (const dir of options.skillDirs) {
      const abs = path.resolve(dir);
      if (await dirExists(abs)) out.push(abs);
    }
    return out;
  }

  const out: string[] = [];
  const seen = new Set<string>();
  const push = async (abs: string) => {
    const key = path.resolve(abs);
    if (seen.has(key)) return;
    if (!(await dirExists(key))) return;
    seen.add(key);
    out.push(key);
  };

  if (options.workspaceRoot) {
    const root = path.resolve(options.workspaceRoot);
    const includeUser = options.includeUserHome !== false;
    if (includeUser) {
      const home = path.resolve(options.homeDir ?? homedir());
      for (const rel of USER_SKILL_REL_DIRS) {
        await push(path.join(home, rel));
      }
    }
    for (const rel of PROJECT_SKILL_REL_DIRS) {
      await push(path.join(root, rel));
    }
  }

  if (options.productDir) {
    await push(path.join(path.resolve(options.productDir), "skills"));
  }

  return out;
}

/** Directory entry count + max mtime — O(children) stats, no SKILL.md reads. */
export async function skillDirFingerprint(skillsRoot: string): Promise<string> {
  const root = path.resolve(skillsRoot);
  try {
    const names = (await readdir(root))
      .filter((n) => !shouldSkipScanDir(n))
      .sort();
    let count = 0;
    let maxMtime = 0;
    const capped = names.slice(0, SKILL_DIR_ENTRY_CAP);
    for (const name of capped) {
      const dir = path.join(root, name);
      try {
        const st = await stat(dir);
        if (!st.isDirectory()) continue;
        count++;
        maxMtime = Math.max(maxMtime, st.mtimeMs);
        try {
          const skillMd = await stat(path.join(dir, "SKILL.md"));
          maxMtime = Math.max(maxMtime, skillMd.mtimeMs);
        } catch {
          /* no SKILL.md */
        }
      } catch {
        continue;
      }
    }
    const truncated = names.length > SKILL_DIR_ENTRY_CAP ? "+trunc" : "";
    return `skills:${root}:${count}:${maxMtime}${truncated}`;
  } catch {
    return `skills:${root}:missing`;
  }
}

export async function skillDirsFingerprint(
  dirs: readonly string[],
): Promise<string> {
  const parts: string[] = [];
  for (const dir of dirs) {
    parts.push(await skillDirFingerprint(dir));
  }
  return parts.join("|");
}
