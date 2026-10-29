/**
 * Single ordered candidate list for standing skill-catalog **and** the `skill`
 * tool (and Face `skill.list` / `/skills`). Callers pass the list to
 * {@link resolveSkillDirs} (`skillDirs:`) so missing roots are skipped and
 * clash order stays identical.
 *
 * Candidate roots (existence skipped later). Catalog **display / truncate**
 * order is {@link orderSkillsForCatalogBudget}: 公文包 → workspace+xrk-* → globals.
 * Name-clash: `preferredSkillDirs` / `extraSkillDirs` beat workspace.
 *
 * Scan list:
 * 1. Product-home `{XRK_HOME}/skills` (seeds + user installs)
 * 2. Optional other home vendors (`includeUserHomeSkills`)
 * 3. Workspace vendor trees + `{productDir}/skills`
 * 4. `extraSkillDirs` (公文包)
 *
 * Progressive disclosure = catalog name+blurb → `skill` body (no skill_search).
 */
import path from "node:path";
import { homedir } from "node:os";
import {
  USER_HOME_SKILL_REL_DIRS,
  WORKSPACE_SKILL_REL_DIRS,
} from "./inject-sources.js";
import {
  resolveUnderUserProductHome,
  resolveUserProductHome,
} from "./user-product-home.js";
import type { SkillDirSourceOptions } from "./skill-dirs.js";

export interface StandingCatalogSkillDirOptions {
  readonly workspaceRoot: string;
  readonly productDir?: string;
  readonly audience?: "user" | "subagent" | "minimal";
  readonly extraSkillDirs?: readonly string[];
  /**
   * Default true — false skips product-home `{XRK_HOME}/skills`
   * (hermetic / test escape hatch).
   */
  readonly includeUserHome?: boolean;
  /** Opt-in non-product home vendors (`~/.agents/skills`, …). Default false. */
  readonly includeUserHomeSkills?: boolean;
  readonly homeDir?: string;
}

/**
 * Ordered absolute skill-root **candidates** (may not exist on disk yet).
 */
export function standingCatalogSkillDirCandidates(
  options: StandingCatalogSkillDirOptions,
): readonly string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (abs: string) => {
    const key = path.resolve(abs);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(key);
  };

  const includeUserHome = options.includeUserHome !== false;
  if (includeUserHome) {
    push(path.join(resolveUserProductHome(options.homeDir), "skills"));
    if (options.includeUserHomeSkills === true) {
      const home = path.resolve(options.homeDir ?? homedir());
      for (const rel of USER_HOME_SKILL_REL_DIRS) {
        const underProduct = resolveUnderUserProductHome(rel, options.homeDir);
        push(underProduct ?? path.join(home, rel));
      }
    }
  }

  {
    const root = path.resolve(options.workspaceRoot);
    for (const rel of WORKSPACE_SKILL_REL_DIRS) {
      push(path.join(root, rel));
    }
    if (options.productDir) {
      push(path.join(path.resolve(options.productDir), "skills"));
    }
  }

  if (options.extraSkillDirs?.length) {
    for (const dir of options.extraSkillDirs) {
      push(path.resolve(dir));
    }
  }

  return out;
}

/**
 * Options for {@link createSkillTools} / {@link listSkills} — same roots as
 * the standing catalog. `workspaceRoot` is kept for name-clash layering even
 * when discovery uses the explicit `skillDirs` list.
 */
export function standingSkillToolSourceOptions(
  options: StandingCatalogSkillDirOptions,
): SkillDirSourceOptions {
  return {
    skillDirs: standingCatalogSkillDirCandidates(options),
    workspaceRoot: options.workspaceRoot,
    ...(options.extraSkillDirs?.length
      ? {
          extraSkillDirs: options.extraSkillDirs,
          preferredSkillDirs: options.extraSkillDirs,
        }
      : {}),
  };
}

