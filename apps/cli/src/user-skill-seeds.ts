/**
 * On product establish (serve/web), install packaged skills into
 * `{XRK_HOME}/skills/` — system data only (Cursor-style home defaults).
 * Never writes the workspace.
 *
 * Refresh policy: a seed is installed when missing, and **re-installed only
 * when the home copy is still byte-identical to the seed we originally wrote**
 * (tracked in `.seed-manifest.json`). Any user edit wins forever — we never
 * clobber it. Copies that predate the manifest are left alone, since their
 * provenance cannot be proven.
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

/** Records, per skill name, the fingerprint of the seed we last wrote home. */
const SEED_MANIFEST_NAME = ".seed-manifest.json";

type SeedManifest = Record<string, string>;

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

export interface EnsureUserSkillSeedsResult {
  readonly homeSkills: string;
  readonly installed: readonly string[];
  /** Stale-but-pristine home copies replaced by a newer bundled seed. */
  readonly refreshed: readonly string[];
  readonly skipped: readonly string[];
}

/**
 * Ensure `{XRK_HOME}/skills/<name>/` for each bundled seed (create home skills dir).
 * Call from app start (`xrkh web` / `serve`) — not from workspace tooling.
 *
 * `seedRoot` is injectable for tests; production uses the CLI-bundled seeds.
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

  const writeSeed = async (name: string): Promise<void> => {
    const dest = path.join(homeSkills, name);
    // `cp` merges into an existing tree; remove first so stale files cannot
    // survive a refresh.
    await rm(dest, { recursive: true, force: true });
    await cp(path.join(seedRoot, name), dest, { recursive: true });
  };

  for (const name of names) {
    const dest = path.join(homeSkills, name);
    const skillMd = path.join(dest, "SKILL.md");
    const seedFingerprint = await fingerprintDir(path.join(seedRoot, name));

    if (!(await pathExists(skillMd))) {
      await writeSeed(name);
      if (seedFingerprint) {
        manifest[name] = seedFingerprint;
        manifestDirty = true;
      }
      installed.push(name);
      continue;
    }

    const recorded = manifest[name];
    // No manifest entry → predates fingerprinting; provenance unknown, so the
    // existing "never overwrite" behaviour is preserved.
    if (!recorded) {
      skipped.push(name);
      continue;
    }
    // Bundled seed unchanged since we wrote it → nothing to do.
    if (recorded === seedFingerprint) {
      skipped.push(name);
      continue;
    }
    // Seed moved on. Refresh only if the home copy is still exactly what we
    // wrote; a user edit (or any local drift) wins forever.
    const homeFingerprint = await fingerprintDir(dest);
    if (homeFingerprint === recorded) {
      await writeSeed(name);
      if (seedFingerprint) {
        manifest[name] = seedFingerprint;
        manifestDirty = true;
      }
      refreshed.push(name);
      continue;
    }
    skipped.push(name);
  }

  if (manifestDirty) {
    await writeFile(
      manifestFile,
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    );
  }

  return { homeSkills, installed, refreshed, skipped };
}
