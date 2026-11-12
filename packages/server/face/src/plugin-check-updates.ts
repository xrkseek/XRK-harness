/**
 * Settings inventory update probe: async `npm view` + Host-side cache.
 * Warm on listen; Settings reads cache or forces a refresh.
 */
import { spawn } from "node:child_process";
import {
  classifyManagedPluginSource,
  isSafePluginPackageName,
  listFacePluginInventory,
  registryPackageNameFromSource,
  type FacePluginInventoryEntry,
} from "./plugin-inventory.js";
import type { FaceRuntime } from "./context.js";

export type PluginUpdateProbeStatus =
  | "idle"
  | "checking"
  | "ready"
  | "error";

export interface PluginUpdateProbeRow {
  readonly entryId: string;
  readonly installed?: string;
  readonly latest?: string;
  readonly updateAvailable: boolean;
  /** Registry probe failed (network / npm / missing package). */
  readonly checkFailed?: boolean;
  /** engine | local | registry | vcs — UI filters the Update action. */
  readonly sourceClass: ReturnType<typeof classifyManagedPluginSource>;
}

export interface PluginUpdateProbeSnapshot {
  readonly status: PluginUpdateProbeStatus;
  readonly updates: readonly PluginUpdateProbeRow[];
  readonly checkedAt?: number;
  readonly error?: string;
}

export type NpmViewVersionFn = (
  packageName: string,
) => Promise<string | undefined>;

/** Parse leading semver core (`1.2.3` from `v1.2.3-beta+meta`). */
function parseSemverCore(raw: string): number[] | undefined {
  const cleaned = raw.trim().replace(/^v/i, "");
  const core = cleaned.split(/[-+]/)[0] ?? "";
  if (!/^\d+(\.\d+)*$/.test(core)) return undefined;
  return core.split(".").map((p) => Number.parseInt(p, 10));
}

/**
 * True when `latest` is strictly newer than `installed` on the numeric core.
 * Unparseable sides → false (never invent an update badge from garbage strings).
 */
export function isNpmVersionNewer(latest: string, installed: string): boolean {
  const a = parseSemverCore(latest);
  const b = parseSemverCore(installed);
  if (!a || !b) return false;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const left = a[i] ?? 0;
    const right = b[i] ?? 0;
    if (left !== right) return left > right;
  }
  return false;
}

/** Bounded parallel map — keeps Host responsive without serializing all npm views. */
async function mapPool<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const limit = Math.max(1, Math.min(concurrency, items.length || 1));
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: limit }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return out;
}

/** Cap concurrent `npm view` spawns per probe (Host warm + Settings force). */
const NPM_VIEW_CONCURRENCY = 4;

/** Async `npm view <name> version` (20s). Returns undefined on failure. */
export function npmViewPackageVersion(
  packageName: string,
): Promise<string | undefined> {
  const name = packageName.trim();
  // Reject CLI-option shaped names (`--registry=…`) before spawn.
  if (!name || !isSafePluginPackageName(name)) {
    return Promise.resolve(undefined);
  }
  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  return new Promise((resolve) => {
    const child = spawn(npmCmd, ["view", name, "version"], {
      windowsHide: true,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let settled = false;
    const finish = (value: string | undefined): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish(undefined);
    }, 20_000);
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.on("error", () => {
      clearTimeout(timer);
      finish(undefined);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        finish(undefined);
        return;
      }
      const line = stdout
        .trim()
        .split(/\r?\n/)
        .map((l) => l.trim())
        .find((l) => l.length > 0);
      finish(line || undefined);
    });
  });
}

async function probeOne(
  entry: FacePluginInventoryEntry,
  viewVersion: NpmViewVersionFn,
): Promise<PluginUpdateProbeRow> {
  const sourceClass = classifyManagedPluginSource(entry.source, entry.entryId);
  const base: PluginUpdateProbeRow = {
    entryId: entry.entryId,
    updateAvailable: false,
    sourceClass,
    ...(entry.version ? { installed: entry.version } : {}),
  };
  if (sourceClass !== "registry") return base;
  const pkg = registryPackageNameFromSource(entry.source, entry.entryId);
  if (!pkg) {
    return { ...base, checkFailed: true };
  }
  const latest = await viewVersion(pkg);
  if (!latest) {
    return { ...base, checkFailed: true };
  }
  const installed = entry.version?.trim() ?? "";
  const updateAvailable =
    installed.length > 0 ? isNpmVersionNewer(latest, installed) : true;
  return {
    ...base,
    latest,
    updateAvailable,
  };
}

type CacheBucket = {
  status: PluginUpdateProbeStatus;
  updates: PluginUpdateProbeRow[];
  checkedAt?: number;
  error?: string;
  inflight?: Promise<PluginUpdateProbeSnapshot>;
};

const cacheByPluginsDir = new Map<string, CacheBucket>();

function cacheKeyOf(
  runtime: Pick<FaceRuntime, "hostPublic" | "productDir">,
): string {
  const dir = runtime.hostPublic?.pluginsDir?.trim();
  if (dir) return dir;
  return runtime.productDir?.trim() || "default";
}

function snapshotOf(bucket: CacheBucket): PluginUpdateProbeSnapshot {
  return {
    status: bucket.status,
    updates: bucket.updates,
    ...(bucket.checkedAt !== undefined ? { checkedAt: bucket.checkedAt } : {}),
    ...(bucket.error ? { error: bucket.error } : {}),
  };
}

/**
 * Probe registry-sourced managed entries for newer npm versions.
 * Non-registry rows are included with `updateAvailable: false`.
 */
export async function checkFacePluginUpdates(
  runtime: Pick<
    FaceRuntime,
    "plugins" | "webPlugins" | "hostPublic" | "productDir"
  >,
  options: {
    readonly entryIds?: readonly string[];
    readonly viewVersion?: NpmViewVersionFn;
  } = {},
): Promise<readonly PluginUpdateProbeRow[]> {
  const view = options.viewVersion ?? npmViewPackageVersion;
  const want = options.entryIds?.length
    ? new Set(options.entryIds.map((id) => id.trim()).filter(Boolean))
    : undefined;
  const targets = listFacePluginInventory(runtime).filter((e) => {
    if (want) return want.has(e.entryId);
    return e.managed === true;
  });
  return mapPool(targets, NPM_VIEW_CONCURRENCY, (entry) =>
    probeOne(entry, view),
  );
}

/** Read the Host-side probe cache without starting work. */
export function getPluginUpdateProbeCache(
  runtime: Pick<FaceRuntime, "hostPublic" | "productDir">,
): PluginUpdateProbeSnapshot {
  const bucket = cacheByPluginsDir.get(cacheKeyOf(runtime));
  if (!bucket) {
    return { status: "idle", updates: [] };
  }
  return snapshotOf(bucket);
}

/**
 * Ensure a probe is running or return the last ready snapshot.
 * `force` always starts a new run (after the current inflight settles).
 */
export async function ensurePluginUpdateProbe(
  runtime: Pick<
    FaceRuntime,
    "plugins" | "webPlugins" | "hostPublic" | "productDir"
  >,
  options: {
    readonly force?: boolean;
    readonly entryIds?: readonly string[];
    readonly viewVersion?: NpmViewVersionFn;
  } = {},
): Promise<PluginUpdateProbeSnapshot> {
  const key = cacheKeyOf(runtime);
  let existing = cacheByPluginsDir.get(key);
  if (!existing) {
    existing = { status: "idle", updates: [] };
    cacheByPluginsDir.set(key, existing);
  }
  const bucket = existing;

  if (!options.force && bucket.status === "ready" && !options.entryIds?.length) {
    return snapshotOf(bucket);
  }
  if (!options.force && bucket.inflight) {
    return bucket.inflight;
  }

  const run = (async (): Promise<PluginUpdateProbeSnapshot> => {
    bucket.status = "checking";
    delete bucket.error;
    try {
      const updates = await checkFacePluginUpdates(runtime, {
        ...(options.entryIds?.length ? { entryIds: options.entryIds } : {}),
        ...(options.viewVersion ? { viewVersion: options.viewVersion } : {}),
      });
      // Full scan updates the durable cache; filtered force keeps prior rows
      // for ids not in this pass.
      if (!options.entryIds?.length) {
        bucket.updates = [...updates];
      } else {
        const byId = new Map(bucket.updates.map((r) => [r.entryId, r]));
        for (const row of updates) byId.set(row.entryId, row);
        bucket.updates = [...byId.values()];
      }
      bucket.status = "ready";
      bucket.checkedAt = Date.now();
      return snapshotOf(bucket);
    } catch (err) {
      bucket.status = "error";
      bucket.error = err instanceof Error ? err.message : String(err);
      return snapshotOf(bucket);
    } finally {
      delete bucket.inflight;
    }
  })();

  bucket.inflight = run;
  return run;
}

/** Fire-and-forget warm probe after HTTP listen (does not block boot). */
export function schedulePluginUpdateProbeWarm(
  runtime: Pick<
    FaceRuntime,
    "plugins" | "webPlugins" | "hostPublic" | "productDir"
  >,
): void {
  void ensurePluginUpdateProbe(runtime).catch(() => {
    /* warm probe is best-effort */
  });
}

/** Test helper — drop in-memory cache. */
export function resetPluginUpdateProbeCacheForTests(): void {
  cacheByPluginsDir.clear();
}
