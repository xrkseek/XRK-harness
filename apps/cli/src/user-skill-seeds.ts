/**
 * Product establish: mirror bundled seeds into `{XRK_HOME}` (never the workspace).
 * Called from `xrkh serve` / `web` and Desktop Host boot after install/update.
 *
 * Refresh policies:
 * - **fingerprint** (skills · recipes · `AGENTS.md`): rewrite when the bundled
 *   fingerprint moves (or the home copy is missing).
 * - **create-once** (`SOUL.md`): install only when missing; never overwrite.
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

const SEED_MANIFEST_NAME = ".seed-manifest.json";
const STANDING_MANIFEST_NAME = ".standing-seed-manifest.json";

type SeedManifest = Record<string, string>;

export type FlatSeedPolicy = "fingerprint" | "create-once";

export interface EnsureUserSkillSeedsResult {
  /** Destination directory (`skills/`, `{XRK_HOME}`, or `recipes/`). */
  readonly targetDir: string;
  readonly installed: readonly string[];
  /** Home copies replaced because the bundled fingerprint moved. */
  readonly refreshed: readonly string[];
  /** Already present / matching fingerprint (or create-once skip). */
  readonly skipped: readonly string[];
}

export interface EnsureUserHomeSeedsResult {
  readonly skills: EnsureUserSkillSeedsResult;
  readonly standing: EnsureUserSkillSeedsResult;
  readonly recipes: EnsureUserSkillSeedsResult;
}

type FlatSeedEntry = {
  readonly name: string;
  readonly policy: FlatSeedPolicy;
};

/** Standing files under `{XRK_HOME}` (README.md in the seed dir is docs-only). */
const STANDING_SEED_ENTRIES: readonly FlatSeedEntry[] = [
  { name: "AGENTS.md", policy: "fingerprint" },
  { name: "SOUL.md", policy: "create-once" },
];

function emptySeedResult(targetDir: string): EnsureUserSkillSeedsResult {
  return { targetDir, installed: [], refreshed: [], skipped: [] };
}

function seedResult(
  targetDir: string,
  installed: readonly string[],
  refreshed: readonly string[],
  skipped: readonly string[],
): EnsureUserSkillSeedsResult {
  return { targetDir, installed, refreshed, skipped };
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

type FlatSeedAction = "installed" | "refreshed" | "skipped";

/**
 * Apply one flat seed file. Updates `manifest[name]` when written.
 * @returns whether the destination was written.
 */
async function applyFlatSeedFile(
  src: string,
  dest: string,
  name: string,
  policy: FlatSeedPolicy,
  seedFingerprint: string,
  manifest: SeedManifest,
): Promise<{ action: FlatSeedAction; dirty: boolean }> {
  const present = await pathExists(dest);

  if (policy === "create-once") {
    if (present) return { action: "skipped", dirty: false };
    await writeFile(dest, await readFile(src));
    manifest[name] = seedFingerprint;
    return { action: "installed", dirty: true };
  }

  if (present && manifest[name] === seedFingerprint) {
    return { action: "skipped", dirty: false };
  }

  await writeFile(dest, await readFile(src));
  manifest[name] = seedFingerprint;
  return { action: present ? "refreshed" : "installed", dirty: true };
}

/**
 * Ensure `{XRK_HOME}/skills/<name>/` mirrors each bundled seed.
 */
export async function ensureUserSkillSeeds(
  xrkHome: string = resolveXrkHome(),
  seedRoot: string = bundledSkillSeedsRoot(),
): Promise<EnsureUserSkillSeedsResult> {
  const targetDir = path.join(path.resolve(xrkHome), "skills");
  const installed: string[] = [];
  const refreshed: string[] = [];
  const skipped: string[] = [];

  if (!existsSync(seedRoot)) {
    return emptySeedResult(targetDir);
  }

  await mkdir(targetDir, { recursive: true });
  const names = (await readdir(seedRoot, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  const manifestFile = path.join(targetDir, SEED_MANIFEST_NAME);
  const manifest = await readManifest(manifestFile);
  let manifestDirty = false;

  for (const name of names) {
    const dest = path.join(targetDir, name);
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
  return seedResult(targetDir, installed, refreshed, skipped);
}

/**
 * Seed named flat files (one manifest write). Used for standing + recipes.
 */
async function ensureFlatFileSeeds(
  destDir: string,
  seedRoot: string,
  manifestName: string,
  entries: readonly FlatSeedEntry[],
): Promise<EnsureUserSkillSeedsResult> {
  const installed: string[] = [];
  const refreshed: string[] = [];
  const skipped: string[] = [];

  if (!existsSync(seedRoot) || entries.length === 0) {
    return emptySeedResult(destDir);
  }

  await mkdir(destDir, { recursive: true });
  const manifestFile = path.join(destDir, manifestName);
  const manifest = await readManifest(manifestFile);
  let manifestDirty = false;

  for (const entry of entries) {
    const src = path.join(seedRoot, entry.name);
    if (!(await pathExists(src))) {
      skipped.push(entry.name);
      continue;
    }
    const seedFingerprint = await fingerprintFile(src);
    if (!seedFingerprint) {
      skipped.push(entry.name);
      continue;
    }
    const { action, dirty } = await applyFlatSeedFile(
      src,
      path.join(destDir, entry.name),
      entry.name,
      entry.policy,
      seedFingerprint,
      manifest,
    );
    if (dirty) manifestDirty = true;
    if (action === "installed") installed.push(entry.name);
    else if (action === "refreshed") refreshed.push(entry.name);
    else skipped.push(entry.name);
  }

  if (manifestDirty) await writeManifest(manifestFile, manifest);
  return seedResult(destDir, installed, refreshed, skipped);
}

/** Global `AGENTS.md` + `SOUL.md` under `{XRK_HOME}`. */
export async function ensureUserStandingSeeds(
  xrkHome: string = resolveXrkHome(),
  seedRoot: string = bundledStandingSeedsRoot(),
): Promise<EnsureUserSkillSeedsResult> {
  return ensureFlatFileSeeds(
    path.resolve(xrkHome),
    seedRoot,
    STANDING_MANIFEST_NAME,
    STANDING_SEED_ENTRIES,
  );
}

/** Slash recipes under `{XRK_HOME}/recipes/`. */
export async function ensureUserRecipeSeeds(
  xrkHome: string = resolveXrkHome(),
  seedRoot: string = bundledRecipeSeedsRoot(),
): Promise<EnsureUserSkillSeedsResult> {
  const targetDir = path.join(path.resolve(xrkHome), "recipes");
  if (!existsSync(seedRoot)) return emptySeedResult(targetDir);

  const names = (await readdir(seedRoot, { withFileTypes: true }))
    .filter(
      (e) =>
        e.isFile() && (e.name.endsWith(".yaml") || e.name.endsWith(".yml")),
    )
    .map((e) => e.name)
    .sort();
  return ensureFlatFileSeeds(
    targetDir,
    seedRoot,
    SEED_MANIFEST_NAME,
    names.map((name) => ({ name, policy: "fingerprint" as const })),
  );
}

/** Skills + standing + recipes under `{XRK_HOME}`. */
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

const HOME_SEED_ROWS: readonly {
  readonly label: string;
  readonly key: keyof EnsureUserHomeSeedsResult;
}[] = [
  { label: "skills", key: "skills" },
  { label: "standing", key: "standing" },
  { label: "recipes", key: "recipes" },
];

/** Log lines for Host establish (`serve` / Desktop boot). */
export function formatHomeSeedLogLines(
  home: string,
  seeded: EnsureUserHomeSeedsResult,
): string[] {
  const lines: string[] = [];
  for (const { label, key } of HOME_SEED_ROWS) {
    const row = seeded[key];
    if (row.installed.length > 0) {
      lines.push(`home ${label}: ${row.installed.join(", ")} → ${home}`);
    }
    if (row.refreshed.length > 0) {
      lines.push(`home ${label} refreshed: ${row.refreshed.join(", ")}`);
    }
  }
  return lines;
}

/** Compact doctor check detail for the same seed pass. */
export function formatHomeSeedDoctorDetail(
  home: string,
  seeded: EnsureUserHomeSeedsResult,
): string {
  const parts: string[] = [];
  for (const { label, key } of HOME_SEED_ROWS) {
    const row = seeded[key];
    // Doctor uses singular prefixes historically: skill: / standing: / recipe:
    const prefix = label === "skills" ? "skill" : label === "recipes" ? "recipe" : "standing";
    for (const n of row.installed) parts.push(`${prefix}:${n}`);
    for (const n of row.refreshed) parts.push(`${prefix}~${n}`);
  }
  if (parts.length > 0) return `${parts.join(", ")} → ${home}`;
  return `ok ${path.join(home, "skills")}`;
}

/**
 * Product establish used by every Host entry (`xrkh web` / `serve` / Desktop).
 * Seeds `{XRK_HOME}` from the bundled `@xrkseek/harness-cli` `seeds/` tree.
 */
export async function establishProductHomeSeeds(
  xrkHome: string = resolveXrkHome(),
  log?: (message: string) => void,
): Promise<EnsureUserHomeSeedsResult> {
  const home = path.resolve(xrkHome);
  const seeded = await ensureUserHomeSeeds(home);
  if (log) {
    for (const line of formatHomeSeedLogLines(home, seeded)) {
      log(line);
    }
  }
  return seeded;
}
