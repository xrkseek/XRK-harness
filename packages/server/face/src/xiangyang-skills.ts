/**
 * Seed 向阳空间-only skills under the workspace `.xrk/skills` tree.
 * Other workspaces do not get these files (workspace-scoped catalog).
 *
 * Product bodies live in `./xiangyang-skill-bodies/` and refresh when text
 * changes (compare-and-write). Add sibling skill folders for local custom
 * playbooks — seed never deletes unknown ids.
 */

import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import {
  XIANGYANG_SKILL_SEEDS,
  XIANGYANG_SKILLS_REVISION,
  type XiangyangSkillSeed,
} from "./xiangyang-skill-bodies/index.js";

export type { XiangyangSkillSeed };
export {
  XIANGYANG_SKILL_SEEDS,
  XIANGYANG_SKILL_IDS,
  XIANGYANG_SKILLS_REVISION,
} from "./xiangyang-skill-bodies/index.js";

export interface SeedXiangyangSkillsResult {
  /** Skill ids whose SKILL.md was created or rewritten. */
  readonly installed: string[];
  /** Product catalog revision (`XIANGYANG_SKILLS_REVISION`). */
  readonly revision: number;
}

/**
 * Write / refresh product skill folders under the 向阳空间 workspace.
 * @param xiangyangRoot - Absolute path of the reserved workspace directory.
 */
export async function seedXiangyangSkills(
  xiangyangRoot: string,
): Promise<SeedXiangyangSkillsResult> {
  const skillsRoot = path.join(xiangyangRoot, ".xrk", "skills");
  await mkdir(skillsRoot, { recursive: true });
  const installed: string[] = [];
  for (const skill of XIANGYANG_SKILL_SEEDS) {
    const dir = path.join(skillsRoot, skill.id);
    const file = path.join(dir, "SKILL.md");
    let previous: string | undefined;
    try {
      previous = await readFile(file, "utf8");
    } catch {
      previous = undefined;
    }
    if (previous === skill.body) continue;
    await mkdir(dir, { recursive: true });
    await writeFile(file, skill.body, "utf8");
    installed.push(skill.id);
  }
  return { installed, revision: XIANGYANG_SKILLS_REVISION };
}
