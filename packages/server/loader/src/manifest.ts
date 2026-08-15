import { access, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

/** On-disk plugin descriptor (xrk.plugin.json or package.json#xrkseek.plugin). */
export interface PluginManifest {
  readonly id: string;
  readonly kind: string;
  /** Entry module path relative to plugin root (ESM). */
  readonly entry: string;
}

export interface DiscoveryHit {
  readonly root: string;
  /** Absolute path to the entry module. */
  readonly entry: string;
  readonly manifest: PluginManifest;
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

function parseManifestObject(
  raw: unknown,
  source: string,
): PluginManifest {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${source}: expected plugin object`);
  }
  const o = raw as Record<string, unknown>;
  const id = o.id;
  const kind = o.kind;
  const entry = o.entry;
  if (typeof id !== "string" || !id.trim()) {
    throw new Error(`${source}: missing string id`);
  }
  if (typeof kind !== "string" || !kind.trim()) {
    throw new Error(`${source}: missing string kind`);
  }
  if (typeof entry !== "string" || !entry.trim()) {
    throw new Error(`${source}: missing string entry`);
  }
  return { id: id.trim(), kind: kind.trim(), entry: entry.trim() };
}

async function readManifestAt(
  root: string,
): Promise<PluginManifest | undefined> {
  const xrkPath = path.join(root, "xrk.plugin.json");
  if (await exists(xrkPath)) {
    const text = await readFile(xrkPath, "utf8");
    return parseManifestObject(JSON.parse(text), xrkPath);
  }

  const pkgPath = path.join(root, "package.json");
  if (!(await exists(pkgPath))) return undefined;
  const pkg = JSON.parse(await readFile(pkgPath, "utf8")) as {
    xrkseek?: { plugin?: unknown };
  };
  if (!pkg.xrkseek?.plugin) return undefined;
  return parseManifestObject(pkg.xrkseek.plugin, `${pkgPath}#xrkseek.plugin`);
}

async function hitFromRoot(root: string): Promise<DiscoveryHit | undefined> {
  const manifest = await readManifestAt(root);
  if (!manifest) return undefined;
  const entry = path.resolve(root, manifest.entry);
  if (!(await exists(entry))) {
    throw new Error(
      `plugin ${manifest.id}: entry not found: ${manifest.entry} (resolved ${entry})`,
    );
  }
  return { root: path.resolve(root), entry, manifest };
}

/**
 * Scan `dir` for plugins:
 * - if `dir` itself has a manifest → one hit
 * - else each immediate subdirectory with a manifest
 *
 * Manifest: `xrk.plugin.json` or `package.json` → `xrkseek.plugin`.
 */
export async function scanPluginDir(dir: string): Promise<readonly DiscoveryHit[]> {
  const root = path.resolve(dir);
  if (!(await exists(root))) {
    throw new Error(`plugin discover dir not found: ${root}`);
  }
  const st = await stat(root);
  if (!st.isDirectory()) {
    throw new Error(`plugin discover path is not a directory: ${root}`);
  }

  const self = await hitFromRoot(root);
  if (self) return [self];

  const names = await readdir(root);
  const hits: DiscoveryHit[] = [];
  for (const name of names.sort()) {
    const child = path.join(root, name);
    const cst = await stat(child).catch(() => undefined);
    if (!cst?.isDirectory()) continue;
    const hit = await hitFromRoot(child);
    if (hit) hits.push(hit);
  }
  return hits;
}
