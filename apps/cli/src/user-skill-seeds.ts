/**
 * Opt-in install of packaged product skills into `{XRK_HOME}/skills/`.
 * Never creates `~/.xrk` or `skills/` unless the user opts in (Cursor/Trae:
 * no surprise project/home dirs). Missing skills only — never overwrite edits.
 */
import { cp, mkdir, readdir, access } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { resolveXrkHome } from "@xrkseek/server-config";
import { cliPackageRoot } from "./product-paths.js";

export function bundledSkillSeedsRoot(): string {
  return path.join(cliPackageRoot(), "seeds", "skills");
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

function envSeedRequested(): boolean {
  const raw = process.env.XRK_SEED_SKILLS?.trim() ?? "";
  return /^(1|true|yes)$/i.test(raw);
}

export interface EnsureUserSkillSeedsResult {
  readonly homeSkills: string;
  readonly installed: readonly string[];
  readonly skipped: readonly string[];
  /** True when no install ran (opt-in not set / home skills dir absent). */
  readonly deferred: boolean;
}

export interface EnsureUserSkillSeedsOptions {
  /** Explicit install (e.g. `xrkh doctor --seed-skills`). */
  readonly force?: boolean;
}

/**
 * Copy each `seeds/skills/<name>/` into `{XRK_HOME}/skills/<name>/` when absent.
 * Runs only if `force`, `XRK_SEED_SKILLS=1`, or `{XRK_HOME}/skills` already exists.
 */
export async function ensureUserSkillSeeds(
  xrkHome: string = resolveXrkHome(),
  options: EnsureUserSkillSeedsOptions = {},
): Promise<EnsureUserSkillSeedsResult> {
  const homeSkills = path.join(path.resolve(xrkHome), "skills");
  const seedRoot = bundledSkillSeedsRoot();
  const installed: string[] = [];
  const skipped: string[] = [];

  if (!existsSync(seedRoot)) {
    return { homeSkills, installed, skipped, deferred: true };
  }

  const optedIn =
    options.force === true || envSeedRequested() || existsSync(homeSkills);
  if (!optedIn) {
    return { homeSkills, installed, skipped, deferred: true };
  }

  await mkdir(homeSkills, { recursive: true });
  const names = (await readdir(seedRoot, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  for (const name of names) {
    const dest = path.join(homeSkills, name);
    const skillMd = path.join(dest, "SKILL.md");
    if (await pathExists(skillMd)) {
      skipped.push(name);
      continue;
    }
    await cp(path.join(seedRoot, name), dest, { recursive: true });
    installed.push(name);
  }

  return { homeSkills, installed, skipped, deferred: false };
}
