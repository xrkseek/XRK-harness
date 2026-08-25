import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import {
  resolveSkillDirs,
  skillDirsFingerprint,
} from "./skill-dirs.js";

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

  const skillDirs = await resolveSkillDirs({
    workspaceRoot: root,
    productDir,
    includeUserHome:
      options.includeUserHome !== false
      && options.includeUserHomeSkills !== false,
    ...(options.homeDir !== undefined ? { homeDir: options.homeDir } : {}),
  });
  parts.push(await skillDirsFingerprint(skillDirs));

  return parts.join("|");
}

export { skillDirFingerprint, skillDirsFingerprint } from "./skill-dirs.js";
