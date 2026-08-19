import { access, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

/** On-disk plugin descriptor (xrk.plugin.json or package.json plugin fields). */
export interface PluginManifest {
  readonly id: string;
  readonly kind: string;
  /** Entry module path relative to plugin root (ESM). Unused when `skipLoad`. */
  readonly entry: string;
  /**
   * Register without importing the module.
   * Used for DSH Cordis host packages (no `apply(ctx)` on this Host).
   */
  readonly skipLoad?: boolean;
}

export interface DiscoveryHit {
  readonly root: string;
  /** Absolute path to the entry module (may not exist when `skipLoad`). */
  readonly entry: string;
  readonly manifest: PluginManifest;
}

const SKIP_CHILD_DIRS = new Set([
  "node_modules",
  "web",
  "client",
  "dist",
  ".git",
]);

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
  const kindTrim = kind.trim();
  return {
    id: id.trim(),
    kind: kindTrim,
    entry: entry.trim(),
    ...(kindTrim === "cordis" ? { skipLoad: true as const } : {}),
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function nestedPluginField(
  pkg: Record<string, unknown>,
  ns: string,
): unknown | undefined {
  const nested = asRecord(pkg[ns]);
  return nested?.plugin;
}

function packagePluginField(pkg: Record<string, unknown>): unknown | undefined {
  return (
    nestedPluginField(pkg, "xrkseek") ??
    nestedPluginField(pkg, "dsh") ??
    nestedPluginField(pkg, "deepseek") ??
    pkg["dsh.plugin"] ??
    pkg["deepseek.plugin"]
  );
}

function packagePluginSource(pkg: Record<string, unknown>, pkgPath: string): string {
  if (nestedPluginField(pkg, "xrkseek") !== undefined) {
    return `${pkgPath}#xrkseek.plugin`;
  }
  if (nestedPluginField(pkg, "dsh") !== undefined) {
    return `${pkgPath}#dsh.plugin`;
  }
  if (nestedPluginField(pkg, "deepseek") !== undefined) {
    return `${pkgPath}#deepseek.plugin`;
  }
  if (pkg["dsh.plugin"] !== undefined) return `${pkgPath}#dsh.plugin`;
  return `${pkgPath}#deepseek.plugin`;
}

function hasCordisDep(deps: unknown): boolean {
  const rec = asRecord(deps);
  return Boolean(rec && "@xrkseek/cordis" in rec);
}

function cordisStubManifest(
  pkg: Record<string, unknown>,
): PluginManifest | undefined {
  const name = typeof pkg.name === "string" ? pkg.name.trim() : "";
  if (!name || name === "@xrkseek/cordis") return undefined;
  if (
    !hasCordisDep(pkg.peerDependencies) &&
    !hasCordisDep(pkg.dependencies)
  ) {
    return undefined;
  }
  const main =
    (typeof pkg.module === "string" && pkg.module.trim()) ||
    (typeof pkg.main === "string" && pkg.main.trim()) ||
    "./index.js";
  return {
    id: name,
    kind: "cordis",
    entry: main,
    skipLoad: true,
  };
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
  const pkg = JSON.parse(await readFile(pkgPath, "utf8")) as Record<
    string,
    unknown
  >;
  const field = packagePluginField(pkg);
  if (field !== undefined) {
    return parseManifestObject(field, packagePluginSource(pkg, pkgPath));
  }
  return cordisStubManifest(pkg);
}

async function hitFromRoot(root: string): Promise<DiscoveryHit | undefined> {
  const manifest = await readManifestAt(root);
  if (!manifest) return undefined;
  const entry = path.resolve(root, manifest.entry);
  if (!manifest.skipLoad && !(await exists(entry))) {
    throw new Error(
      `plugin ${manifest.id}: entry not found: ${manifest.entry} (resolved ${entry})`,
    );
  }
  return { root: path.resolve(root), entry, manifest };
}

function skipChildName(name: string): boolean {
  return SKIP_CHILD_DIRS.has(name);
}

async function collectChildHits(
  parent: string,
  names: readonly string[],
  hits: DiscoveryHit[],
): Promise<void> {
  for (const name of names) {
    if (skipChildName(name)) continue;
    const child = path.join(parent, name);
    const cst = await stat(child).catch(() => undefined);
    if (!cst?.isDirectory()) continue;
    if (name.startsWith("@")) {
      const scoped = await readdir(child);
      await collectChildHits(child, scoped.sort(), hits);
      continue;
    }
    const hit = await hitFromRoot(child);
    if (hit) hits.push(hit);
  }
}

/**
 * Scan `dir` for plugins:
 * - if `dir` itself has a manifest → one hit
 * - else each immediate subdirectory with a manifest
 *   (`@scope/pkg` two-level; skip `node_modules` / `web` / `client`)
 *
 * Manifest: `xrk.plugin.json`, `package.json` `xrkseek.plugin` /
 * `dsh.plugin` / `deepseek.plugin`, or a Cordis-host stub (peer/dep
 * `@xrkseek/cordis`, `skipLoad`).
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
  await collectChildHits(root, names.sort(), hits);
  return hits;
}
