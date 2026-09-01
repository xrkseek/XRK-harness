/**
 * On product establish (serve/web), install packaged skills into
 * `{XRK_HOME}/skills/` — system data only (Cursor-style home defaults).
 * Never writes the workspace. Missing skills only — never overwrite user edits.
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

export interface EnsureUserSkillSeedsResult {
  readonly homeSkills: string;
  readonly installed: readonly string[];
  readonly skipped: readonly string[];
}

/**
 * Ensure `{XRK_HOME}/skills/<name>/` for each bundled seed (create home skills dir).
 * Call from app start (`xrkh web` / `serve`) — not from workspace tooling.
 */
export async function ensureUserSkillSeeds(
  xrkHome: string = resolveXrkHome(),
): Promise<EnsureUserSkillSeedsResult> {
  const homeSkills = path.join(path.resolve(xrkHome), "skills");
  const seedRoot = bundledSkillSeedsRoot();
  const installed: string[] = [];
  const skipped: string[] = [];

  if (!existsSync(seedRoot)) {
    return { homeSkills, installed, skipped };
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

  return { homeSkills, installed, skipped };
}
