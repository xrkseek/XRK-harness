/**
 * Managed plugin disk state under `{pluginsDir}` (CLI inventory + soft-disable).
 *
 * Leaf module shared by loader consumers (Face · HTTP · Host · CLI).
 * Codex posture: one durable id, alias canonicalize, atomic / content-stable writes.
 */
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { atomicWriteText } from "./atomic-write.js";
import type { DiscoveryHit } from "./manifest.js";

export const DISABLED_PLUGINS_FILE = ".xrk-plugins-disabled.json";
export const MANAGED_PLUGINS_INVENTORY_FILE = ".xrk-plugins.json";

/** Map any inventory key / package name → durable soft-disable id. */
export interface ManagedPackageIndex {
  /** Canonical package names recorded in inventory. */
  readonly names: ReadonlySet<string>;
  /** All known keys and names (for orphan pruning). */
  readonly known: ReadonlySet<string>;
  /** Resolve key or name to inventory package name; undefined if unknown. */
  resolve(id: string): string | undefined;
}

/** One row from `.xrk-plugins.json` (keyed by durable package name). */
export interface ManagedPluginPackageMeta {
  readonly name: string;
  readonly version?: string;
  readonly kind?: string;
  readonly source?: string;
  readonly installedAt?: string;
  readonly clientInject?: readonly string[];
  readonly clientImmediately?: boolean;
}

export function disabledPluginsPath(pluginsDir: string): string {
  return path.join(path.resolve(pluginsDir), DISABLED_PLUGINS_FILE);
}

export function managedPluginsInventoryPath(pluginsDir: string): string {
  return path.join(path.resolve(pluginsDir), MANAGED_PLUGINS_INVENTORY_FILE);
}

/**
 * Read CLI inventory packages keyed by durable package name
 * (`entry.name` when set, else object key).
 */
export function readManagedPluginPackagesAt(
  pluginsDir: string,
): Map<string, ManagedPluginPackageMeta> {
  const out = new Map<string, ManagedPluginPackageMeta>();
  const invPath = managedPluginsInventoryPath(pluginsDir);
  if (!existsSync(invPath)) return out;
  try {
    const raw = JSON.parse(readFileSync(invPath, "utf8")) as {
      packages?: Record<
        string,
        {
          name?: unknown;
          version?: unknown;
          kind?: unknown;
          source?: unknown;
          installedAt?: unknown;
          clientInject?: unknown;
          clientImmediately?: unknown;
        }
      >;
    };
    for (const [key, entry] of Object.entries(raw.packages ?? {})) {
      const keyTrim = key.trim();
      const name =
        typeof entry?.name === "string" && entry.name.trim()
          ? entry.name.trim()
          : keyTrim;
      if (!name) continue;
      const version =
        typeof entry.version === "string" && entry.version.trim()
          ? entry.version.trim()
          : undefined;
      const kind =
        typeof entry.kind === "string" && entry.kind.trim()
          ? entry.kind.trim()
          : undefined;
      const source =
        typeof entry.source === "string" && entry.source.trim()
          ? entry.source.trim()
          : undefined;
      const installedAt =
        typeof entry.installedAt === "string" && entry.installedAt.trim()
          ? entry.installedAt.trim()
          : undefined;
      const clientInject = Array.isArray(entry.clientInject)
        ? entry.clientInject.filter(
            (x): x is string => typeof x === "string" && Boolean(x.trim()),
          )
        : undefined;
      const clientImmediately = entry.clientImmediately === true;
      out.set(name, {
        name,
        ...(version ? { version } : {}),
        ...(kind ? { kind } : {}),
        ...(source ? { source } : {}),
        ...(installedAt ? { installedAt } : {}),
        ...(clientInject && clientInject.length > 0
          ? { clientInject }
          : {}),
        ...(clientImmediately ? { clientImmediately: true } : {}),
      });
    }
  } catch {
    /* empty */
  }
  return out;
}

/**
 * Resolve update/reinstall source for a managed package (entryId or aliases).
 */
export function lookupManagedPluginSourceAt(
  pluginsDir: string,
  ...ids: readonly string[]
): string | undefined {
  const packages = readManagedPluginPackagesAt(pluginsDir);
  const index = readManagedPackageIndexAt(pluginsDir);
  const wanted = new Set<string>();
  for (const raw of ids) {
    const id = raw.trim();
    if (!id) continue;
    wanted.add(id);
    const canonical = index.resolve(id);
    if (canonical) wanted.add(canonical);
  }
  for (const id of wanted) {
    const source = packages.get(id)?.source?.trim();
    if (source) return source;
  }
  // Key may differ from durable name — scan raw file aliases via index.
  for (const [name, meta] of packages) {
    if (!wanted.has(name)) continue;
    const source = meta.source?.trim();
    if (source) return source;
  }
  return undefined;
}

/**
 * Index `.xrk-plugins.json` so soft-disable keys can canonicalize across
 * inventory key vs `entry.name` drift.
 */
export function readManagedPackageIndexAt(
  pluginsDir: string,
): ManagedPackageIndex {
  const names = new Set<string>();
  const known = new Set<string>();
  const aliasToName = new Map<string, string>();
  const invPath = managedPluginsInventoryPath(pluginsDir);
  if (!existsSync(invPath)) {
    return {
      names,
      known,
      resolve: () => undefined,
    };
  }
  try {
    const raw = JSON.parse(readFileSync(invPath, "utf8")) as {
      packages?: Record<string, { name?: unknown }>;
    };
    for (const [key, entry] of Object.entries(raw.packages ?? {})) {
      const keyTrim = key.trim();
      const nameTrim =
        typeof entry?.name === "string" && entry.name.trim()
          ? entry.name.trim()
          : keyTrim;
      if (!nameTrim) continue;
      names.add(nameTrim);
      known.add(nameTrim);
      aliasToName.set(nameTrim, nameTrim);
      if (keyTrim) {
        known.add(keyTrim);
        aliasToName.set(keyTrim, nameTrim);
      }
    }
  } catch {
    /* empty index */
  }
  return {
    names,
    known,
    resolve(id: string) {
      const trimmed = id.trim();
      if (!trimmed) return undefined;
      return aliasToName.get(trimmed);
    },
  };
}

/** Soft-disabled managed plugin ids under a plugins directory. */
export function readDisabledPluginIdsAt(pluginsDir: string): Set<string> {
  const file = disabledPluginsPath(pluginsDir);
  const out = new Set<string>();
  if (!existsSync(file)) return out;
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as { ids?: unknown };
    if (!Array.isArray(raw.ids)) return out;
    for (const id of raw.ids) {
      if (typeof id === "string" && id.trim()) out.add(id.trim());
    }
  } catch {
    /* empty */
  }
  return out;
}

/** Persist soft-disable list (empty set removes the marker file). */
export function writeDisabledPluginIdsAt(
  pluginsDir: string,
  ids: ReadonlySet<string>,
): void {
  const dir = path.resolve(pluginsDir);
  mkdirSync(dir, { recursive: true });
  const file = disabledPluginsPath(dir);
  const sorted = [...ids].map((id) => id.trim()).filter(Boolean).sort();
  if (sorted.length === 0) {
    if (existsSync(file)) rmSync(file, { force: true });
    return;
  }
  const body = `${JSON.stringify({ ids: sorted }, null, 2)}\n`;
  if (existsSync(file)) {
    try {
      if (readFileSync(file, "utf8") === body) return;
    } catch {
      /* rewrite */
    }
  }
  atomicWriteText(file, body);
}

/**
 * Whether `id` is soft-disabled, resolving inventory aliases to the durable
 * package name (and matching stale alias rows still on disk).
 */
export function isPluginSoftDisabledAt(
  id: string,
  disabled: ReadonlySet<string>,
  index?: ManagedPackageIndex,
): boolean {
  const trimmed = id.trim();
  if (!trimmed) return false;
  if (disabled.has(trimmed)) return true;
  const canonical = index?.resolve(trimmed);
  if (canonical && disabled.has(canonical)) return true;
  if (!index) return false;
  for (const d of disabled) {
    if (index.resolve(d) === (canonical ?? trimmed)) return true;
  }
  return false;
}

/**
 * Collapse aliases → inventory package names and drop ids not in inventory.
 * Returns whether the set changed.
 */
export function canonicalizeDisabledPluginIdsAt(
  pluginsDir: string,
  disabled: Set<string>,
  index: ManagedPackageIndex = readManagedPackageIndexAt(pluginsDir),
): boolean {
  const next = new Set<string>();
  for (const id of disabled) {
    const canonical = index.resolve(id);
    if (!canonical) continue;
    next.add(canonical);
  }
  if (next.size === disabled.size) {
    let same = true;
    for (const id of next) {
      if (!disabled.has(id)) {
        same = false;
        break;
      }
    }
    if (same) return false;
  }
  disabled.clear();
  for (const id of next) disabled.add(id);
  return true;
}

/**
 * Clear soft-disable for one or more ids (and any aliases that resolve to the
 * same inventory package). Returns true when the on-disk set changed.
 */
export function clearSoftDisabledIdsAt(
  pluginsDir: string,
  ...rawIds: readonly string[]
): boolean {
  const root = path.resolve(pluginsDir);
  const disabled = readDisabledPluginIdsAt(root);
  if (disabled.size === 0) return false;
  const index = readManagedPackageIndexAt(root);
  const targets = new Set<string>();
  for (const raw of rawIds) {
    const id = raw.trim();
    if (!id) continue;
    targets.add(id);
    const canonical = index.resolve(id);
    if (canonical) targets.add(canonical);
  }
  if (targets.size === 0) return false;

  let dirty = false;
  for (const d of [...disabled]) {
    const dCanon = index.resolve(d) ?? d;
    if (targets.has(d) || targets.has(dCanon)) {
      disabled.delete(d);
      dirty = true;
    }
  }
  if (dirty) writeDisabledPluginIdsAt(root, disabled);
  return dirty;
}

/**
 * Soft-disable or re-enable a managed package using the durable inventory name.
 * Always strips aliases so the disabled file stays canonical.
 */
export function setSoftDisabledAt(
  pluginsDir: string,
  options: {
    readonly enabled: boolean;
    readonly entryId: string;
    readonly aliases?: readonly string[];
  },
): void {
  const root = path.resolve(pluginsDir);
  const index = readManagedPackageIndexAt(root);
  const aliases = new Set<string>();
  for (const id of [options.entryId, ...(options.aliases ?? [])]) {
    const trimmed = id?.trim();
    if (trimmed) aliases.add(trimmed);
  }
  const canonical =
    [...aliases].map((a) => index.resolve(a)).find(Boolean) ??
    options.entryId.trim();
  if (!canonical) return;

  const disabled = readDisabledPluginIdsAt(root);
  for (const d of [...disabled]) {
    const dCanon = index.resolve(d) ?? d;
    if (aliases.has(d) || aliases.has(dCanon) || dCanon === canonical) {
      disabled.delete(d);
    }
  }
  if (!options.enabled) disabled.add(canonical);
  writeDisabledPluginIdsAt(root, disabled);
}

/** Discovery + load surface for live soft-disable / remove reconcile. */
export interface SoftDisableReconcileLoader {
  list(): readonly { readonly id: string }[];
  unregister(id: string): Promise<void>;
  discover(dir: string): Promise<readonly DiscoveryHit[]>;
  load(hit: DiscoveryHit): Promise<unknown>;
}

/**
 * Live reconcile process plugins with managed inventory + soft-disable:
 * - unregister soft-disabled ids (never `mcp:*`)
 * - unregister ids no longer discoverable under `pluginsDir` (CLI remove)
 * - load discoverable ids that are enabled but missing from the loader
 *
 * Disk intent applies in-process for the process half; client half still
 * needs a browser reload (`needsRestart`).
 */
export async function reconcileManagedProcessPlugins(
  loader: SoftDisableReconcileLoader,
  pluginsDir: string,
): Promise<readonly string[]> {
  const root = path.resolve(pluginsDir);
  const disabled = readDisabledPluginIdsAt(root);
  const index = readManagedPackageIndexAt(root);
  const hits = await loader.discover(root);
  const discoveredIds = new Set(hits.map((h) => h.manifest.id));

  for (const plugin of [...loader.list()]) {
    if (plugin.id.startsWith("mcp:")) continue;
    const softDisabled = isPluginSoftDisabledAt(
      plugin.id,
      disabled,
      index,
    );
    const missingOnDisk = !discoveredIds.has(plugin.id);
    if (!softDisabled && !missingOnDisk) continue;
    await loader.unregister(plugin.id);
  }

  const live = new Set(loader.list().map((p) => p.id));
  for (const hit of hits) {
    const id = hit.manifest.id;
    if (live.has(id)) continue;
    if (id.startsWith("mcp:")) continue;
    if (isPluginSoftDisabledAt(id, disabled, index)) continue;
    await loader.load(hit);
    live.add(id);
  }
  return loader.list().map((p) => p.id);
}

