import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { PROJECT_SKILL_REL_DIRS, USER_SKILL_REL_DIRS } from "./skills.js";
import { shouldSkipScanDir } from "./scan-guards.js";

export interface InjectFingerprintOptions {
  readonly root: string;
  readonly productDir: string;
  readonly includeUserHome?: boolean;
  readonly homeDir?: string;
  readonly includeUserHomeSkills?: boolean;
}

const INSTRUCTION_MARKERS = [
  ".codex/AGENTS.md",
  "CODEX.md",
  ".claude/CLAUDE.md",
  ".agents/AGENTS.md",
  ".agents/rules",
  ".agents/context",
  ".cursor/rules",
  ".github/copilot-instructions.md",
  ".github/instructions",
  ".xrk/AGENTS.md",
  ".xrk/SOUL.md",
  "AGENTS.md",
  "CLAUDE.md",
  "assistant.md",
  "rules.md",
  "subagents.md",
] as const;

const SKILL_DIR_ENTRY_CAP = 512;

async function markerFingerprint(base: string, rel: string): Promise<string> {
  const abs = path.join(base, ...rel.split("/"));
  try {
    const st = await stat(abs);
    return `${rel}:${st.mtimeMs}:${st.size}`;
  } catch {
    return `${rel}:missing`;
  }
}

/**
 * Cheap invalidation token — stat markers only, no file reads.
 * Codex rebuilds instructions once per session; we invalidate when mtimes move.
 */
export async function computeInjectFingerprint(
  options: InjectFingerprintOptions,
): Promise<string> {
  const root = path.resolve(options.root);
  const productDir = path.resolve(options.productDir);
  const parts: string[] = [`root:${root}`, `product:${productDir}`];

  const bases: string[] = [];
  if (options.includeUserHome !== false) {
    bases.push(path.resolve(options.homeDir ?? homedir()));
  }
  bases.push(root);

  for (const base of bases) {
    const prefix = base === root ? "ws" : "home";
    for (const rel of INSTRUCTION_MARKERS) {
      parts.push(`${prefix}:${await markerFingerprint(base, rel)}`);
    }
    if (base === root) {
      parts.push(`ws-product:${await markerFingerprint(productDir, "AGENTS.md")}`);
    }
  }

  const skillRoots: string[] = [];
  if (options.includeUserHomeSkills !== false && options.includeUserHome !== false) {
    const home = path.resolve(options.homeDir ?? homedir());
    for (const rel of USER_SKILL_REL_DIRS) {
      skillRoots.push(path.join(home, rel));
    }
  }
  for (const rel of PROJECT_SKILL_REL_DIRS) {
    skillRoots.push(path.join(root, rel));
  }
  if (productDir) {
    skillRoots.push(path.join(productDir, "skills"));
  }

  for (const dir of skillRoots) {
    parts.push(await skillDirFingerprint(dir));
  }

  return parts.join("|");
}

/** Directory entry count + max mtime — O(children) stats, no SKILL.md reads. */
export async function skillDirFingerprint(skillsRoot: string): Promise<string> {
  const root = path.resolve(skillsRoot);
  try {
    const names = (await readdir(root)).filter((n) => !shouldSkipScanDir(n));
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

/** Fingerprint for one or more skill roots (shared with skill list cache). */
export async function skillDirsFingerprint(
  dirs: readonly string[],
): Promise<string> {
  const parts: string[] = [];
  for (const dir of dirs) {
    parts.push(await skillDirFingerprint(dir));
  }
  return parts.join("|");
}
