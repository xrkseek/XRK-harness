/**
 * On product establish (serve/web), mirror bundled seeds into `{XRK_HOME}` —
 * system defaults only (never the workspace).
 *
 * Refresh policy: compare `.seed-manifest.json` to the bundled fingerprint.
 * When they differ (or home copy is missing), rewrite from the bundle.
 * User custom skills / AGENTS.md belong in the workspace `.agents/` (or
 * `.xrk/`), not by editing these home seed copies.
 */
import {
  access,
  cp,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { resolveXrkHome } from "@xrkseek/server-config";
import { cliPackageRoot } from "./product-paths.js";

export function bundledSkillSeedsRoot(): string {
  return path.join(cliPackageRoot(), "seeds", "skills");
}

export function bundledStandingSeedsRoot(): string {
  return path.join(cliPackageRoot(), "seeds", "standing");
}

export function bundledRecipeSeedsRoot(): string {
  return path.join(cliPackageRoot(), "seeds", "recipes");
}

/** Per-name fingerprint of the bundled seed last written into home. */
const SEED_MANIFEST_NAME = ".seed-manifest.json";

type SeedManifest = Record<string, string>;

export interface EnsureUserSkillSeedsResult {
  readonly homeSkills: string;
  readonly installed: readonly string[];
  /** Home copies replaced because the bundled fingerprint moved. */
  readonly refreshed: readonly string[];
  /** Already matching the current bundled fingerprint. */
  readonly skipped: readonly string[];
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/** Content fingerprint of a directory tree: sorted `relPath:sha256` lines. */
async function fingerprintDir(dir: string): Promise<string | undefined> {
  const entries: string[] = [];
  const walk = async (current: string, prefix: string): Promise<void> => {
    let names;
    try {
      names = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of names.sort((a, b) => a.name.localeCompare(b.name))) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(abs, rel);
        continue;
      }
      if (!entry.isFile()) continue;
      try {
        const buf = await readFile(abs);
        entries.push(`${rel}:${createHash("sha256").update(buf).digest("hex")}`);
      } catch {
        entries.push(`${rel}:unreadable`);
      }
    }
  };
  await walk(dir, "");
  if (entries.length === 0) return undefined;
  return createHash("sha256").update(entries.join("\n")).digest("hex");
}

async function fingerprintFile(file: string): Promise<string | undefined> {
  try {
    const buf = await readFile(file);
    return createHash("sha256").update(buf).digest("hex");
  } catch {
    return undefined;
  }
}

async function readManifest(file: string): Promise<SeedManifest> {
  try {
    const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const out: SeedManifest = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "string") out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

async function writeManifest(
  file: string,
  manifest: SeedManifest,
): Promise<void> {
  await writeFile(file, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

/**
 * Ensure `{XRK_HOME}/skills/<name>/` mirrors each bundled seed.
 * Call from app start (`xrkh web` / `serve`) — not from workspace tooling.
 */
export async function ensureUserSkillSeeds(
  xrkHome: string = resolveXrkHome(),
  seedRoot: string = bundledSkillSeedsRoot(),
): Promise<EnsureUserSkillSeedsResult> {
  const homeSkills = path.join(path.resolve(xrkHome), "skills");
  const installed: string[] = [];
  const refreshed: string[] = [];
  const skipped: string[] = [];

  if (!existsSync(seedRoot)) {
    return { homeSkills, installed, refreshed, skipped };
  }

  await mkdir(homeSkills, { recursive: true });
  const names = (await readdir(seedRoot, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  const manifestFile = path.join(homeSkills, SEED_MANIFEST_NAME);
  const manifest = await readManifest(manifestFile);
  let manifestDirty = false;

  for (const name of names) {
    const dest = path.join(homeSkills, name);
    const skillMd = path.join(dest, "SKILL.md");
    const seedFingerprint = await fingerprintDir(path.join(seedRoot, name));
    if (!seedFingerprint) {
      skipped.push(name);
      continue;
    }

    const present = await pathExists(skillMd);
    if (present && manifest[name] === seedFingerprint) {
      skipped.push(name);
      continue;
    }

    await rm(dest, { recursive: true, force: true });
    await cp(path.join(seedRoot, name), dest, { recursive: true });
    manifest[name] = seedFingerprint;
    manifestDirty = true;
    if (present) refreshed.push(name);
    else installed.push(name);
  }

  if (manifestDirty) await writeManifest(manifestFile, manifest);
  return { homeSkills, installed, refreshed, skipped };
}

/**
 * Seed flat files from `seedRoot` into `destDir` (same fingerprint policy).
 */
async function ensureFlatFileSeeds(
  destDir: string,
  seedRoot: string,
  manifestName: string,
  fileFilter?: (name: string) => boolean,
): Promise<EnsureUserSkillSeedsResult> {
  const installed: string[] = [];
  const refreshed: string[] = [];
  const skipped: string[] = [];

  if (!existsSync(seedRoot)) {
    return { homeSkills: destDir, installed, refreshed, skipped };
  }

  await mkdir(destDir, { recursive: true });
  const names = (await readdir(seedRoot, { withFileTypes: true }))
    .filter((e) => e.isFile() && (fileFilter ? fileFilter(e.name) : true))
    .map((e) => e.name)
    .sort();

  const manifestFile = path.join(destDir, manifestName);
  const manifest = await readManifest(manifestFile);
  let manifestDirty = false;

  for (const name of names) {
    const src = path.join(seedRoot, name);
    const dest = path.join(destDir, name);
    const seedFingerprint = await fingerprintFile(src);
    if (!seedFingerprint) {
      skipped.push(name);
      continue;
    }

    const present = await pathExists(dest);
    if (present && manifest[name] === seedFingerprint) {
      skipped.push(name);
      continue;
    }

    await writeFile(dest, await readFile(src));
    manifest[name] = seedFingerprint;
    manifestDirty = true;
    if (present) refreshed.push(name);
    else installed.push(name);
  }

  if (manifestDirty) await writeManifest(manifestFile, manifest);
  return { homeSkills: destDir, installed, refreshed, skipped };
}

/** Global `AGENTS.md` only (`~/.xrk/AGENTS.md`). Workspace overrides → `.agents/`. */
export async function ensureUserStandingSeeds(
  xrkHome: string = resolveXrkHome(),
  seedRoot: string = bundledStandingSeedsRoot(),
): Promise<EnsureUserSkillSeedsResult> {
  return ensureFlatFileSeeds(
    path.resolve(xrkHome),
    seedRoot,
    ".standing-seed-manifest.json",
    (name) => name === "AGENTS.md",
  );
}

/** Slash recipes under `{XRK_HOME}/recipes/`. */
export async function ensureUserRecipeSeeds(
  xrkHome: string = resolveXrkHome(),
  seedRoot: string = bundledRecipeSeedsRoot(),
): Promise<EnsureUserSkillSeedsResult> {
  return ensureFlatFileSeeds(
    path.join(path.resolve(xrkHome), "recipes"),
    seedRoot,
    SEED_MANIFEST_NAME,
    (name) => name.endsWith(".yaml") || name.endsWith(".yml"),
  );
}

export interface EnsureUserHomeSeedsResult {
  readonly skills: EnsureUserSkillSeedsResult;
  readonly standing: EnsureUserSkillSeedsResult;
  readonly recipes: EnsureUserSkillSeedsResult;
}

/** Skills + global AGENTS.md + slash recipes under `{XRK_HOME}`. */
export async function ensureUserHomeSeeds(
  xrkHome: string = resolveXrkHome(),
): Promise<EnsureUserHomeSeedsResult> {
  const home = path.resolve(xrkHome);
  return {
    skills: await ensureUserSkillSeeds(home),
    standing: await ensureUserStandingSeeds(home),
    recipes: await ensureUserRecipeSeeds(home),
  };
}
