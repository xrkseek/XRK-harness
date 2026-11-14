/**
 * Settings inventory update probe: async `npm view` + Host-side cache.
 * Warm on listen; Settings reads cache or forces a refresh.
 *
 * Windows spawn plan + argv hygiene: {@link planNpmViewSpawn} /
 * {@link buildNpmViewVersionArgs} in `@xrkseek/server-http`
 * (Desktop npm-cli.js or ComSpec-wrapped npm.cmd — never bare .cmd).
 * Shared posture for Desktop / CLI Host / Mobile guest Host.
 */
import { spawn } from "node:child_process";
import {
  buildNpmViewVersionArgs,
  normalizeNpmViewNet,
  planNpmViewSpawn,
  type NpmViewNetOptions,
} from "@xrkseek/server-http";
import {
  classifyManagedPluginSource,
  isSafePluginPackageName,
  listFacePluginInventory,
  registryPackageNameFromSource,
  type FacePluginInventoryEntry,
} from "./plugin-inventory.js";
import { publishRemoteEvent } from "./remote-event.js";
import type { FaceBus } from "./bus.js";
import type { FaceRuntime } from "./context.js";

/** Runtime slice for probe cache + optional host/remote-event publish. */
type ProbeRuntime = Pick<
  FaceRuntime,
  "plugins" | "webPlugins" | "hostPublic" | "productDir"
> & {
  readonly bus?: Pick<FaceBus, "publishHost">;
};

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

export type { NpmViewNetOptions };

export type NpmViewVersionFn = (
  packageName: string,
  net?: NpmViewNetOptions,
) => Promise<string | undefined>;

/** Re-export spawn helpers so Face tests / callers share one argv + Windows plan. */
export {
  buildNpmViewVersionArgs,
  normalizeNpmViewNet,
  planNpmViewSpawn,
};

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

/**
 * Async `npm view <name> version` (20s). Returns undefined on failure.
 * Pass Settings `registry` / `proxy` so Desktop / Web / Mobile probes hit the
 * same mirror as `plugin add` (install row localStorage). Non-http(s) net is
 * dropped before argv (see {@link normalizeNpmViewNet}).
 */
export function npmViewPackageVersion(
  packageName: string,
  net?: NpmViewNetOptions,
): Promise<string | undefined> {
  const name = packageName.trim();
  // Reject CLI-option shaped names (`--registry=…`) before spawn.
  if (!name || !isSafePluginPackageName(name)) {
    return Promise.resolve(undefined);
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: string | undefined): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    let child: ReturnType<typeof spawn>;
    try {
      const plan = planNpmViewSpawn(buildNpmViewVersionArgs(name, net));
      child = spawn(plan.file, [...plan.args], {
        windowsHide: true,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        ...(plan.windowsVerbatimArguments
          ? { windowsVerbatimArguments: true }
          : {}),
      });
    } catch {
      // Sync spawn throw (e.g. bad argv) — one package must not abort the probe.
      finish(undefined);
      return;
    }
    let stdout = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish(undefined);
    }, 20_000);
    // Drain stderr so a noisy npm never fills the pipe and stalls close.
    child.stderr?.resume();
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
  // engine / vcs: no npm view (engine is guest-bundled; vcs pins stay on their URL).
  if (sourceClass === "engine" || sourceClass === "vcs") return base;

  let pkg: string | undefined;
  if (sourceClass === "registry") {
    pkg = registryPackageNameFromSource(entry.source, entry.entryId);
    if (!pkg) {
      return { ...base, checkFailed: true };
    }
  } else {
    // local (file:/path / relative): still probe by package id when the id is a
    // safe registry name — Settings can then offer 「更新」→ id@latest even if
    // the install origin was a workspace path (common for community client
    // development installs that are also published).
    const id = entry.entryId.trim();
    if (!id || !isSafePluginPackageName(id)) return base;
    pkg = id;
  }

  const latest = await viewVersion(pkg);
  if (!latest) {
    // Registry miss is a hard fail; local miss stays quiet (may be unpublished).
    return sourceClass === "registry" ? { ...base, checkFailed: true } : base;
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
  /** Monotonic run id — supersedes older force/warm writers. */
  runId: number;
  inflight?: Promise<PluginUpdateProbeSnapshot>;
};

const cacheByPluginsDir = new Map<string, CacheBucket>();

function cacheKeyOf(
  runtime: Pick<FaceRuntime, "hostPublic" | "productDir">,
  net?: NpmViewNetOptions,
): string {
  const dir =
    runtime.hostPublic?.pluginsDir?.trim() ||
    runtime.productDir?.trim() ||
    "default";
  const safe = normalizeNpmViewNet(net);
  // Isolate warm/force caches per Settings mirror so npmmirror ≠ npmjs.
  return `${dir}\0${safe.registry ?? ""}\0${safe.proxy ?? ""}`;
}

/**
 * Notify shells that the Host probe cache settled.
 * Args: status (`ready` | `error`), checkedAt ms — client re-pulls warm cache.
 */
function publishUpdatesChanged(
  runtime: ProbeRuntime,
  snap: PluginUpdateProbeSnapshot,
): void {
  if (!runtime.bus) return;
  if (snap.status !== "ready" && snap.status !== "error") return;
  publishRemoteEvent(runtime.bus, "plugin-inventory/updates-changed", [
    snap.status,
    snap.checkedAt ?? Date.now(),
  ]);
}

/** exactOptionalPropertyTypes-safe net from optional registry/proxy fields. */
function netFromOptions(options: {
  readonly registry?: string;
  readonly proxy?: string;
}): NpmViewNetOptions {
  return normalizeNpmViewNet({
    ...(options.registry !== undefined ? { registry: options.registry } : {}),
    ...(options.proxy !== undefined ? { proxy: options.proxy } : {}),
  });
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
 * Probe managed entries for newer npm versions.
 * Local rows get an advisory registry probe by package id; engine / vcs stay quiet.
 */
export async function checkFacePluginUpdates(
  runtime: ProbeRuntime,
  options: {
    readonly entryIds?: readonly string[];
    readonly viewVersion?: NpmViewVersionFn;
    readonly registry?: string;
    readonly proxy?: string;
  } = {},
): Promise<readonly PluginUpdateProbeRow[]> {
  const net = netFromOptions(options);
  const view: NpmViewVersionFn =
    options.viewVersion ??
    ((name, viewNet) => npmViewPackageVersion(name, viewNet ?? net));
  const boundView: NpmViewVersionFn = (name) => view(name, net);
  const want = options.entryIds?.length
    ? new Set(options.entryIds.map((id) => id.trim()).filter(Boolean))
    : undefined;
  const targets = listFacePluginInventory(runtime).filter((e) => {
    if (want) return want.has(e.entryId);
    return e.managed === true;
  });
  return mapPool(targets, NPM_VIEW_CONCURRENCY, (entry) =>
    probeOne(entry, boundView),
  );
}

/** Read the Host-side probe cache without starting work. */
export function getPluginUpdateProbeCache(
  runtime: Pick<FaceRuntime, "hostPublic" | "productDir">,
  net?: NpmViewNetOptions,
): PluginUpdateProbeSnapshot {
  const bucket = cacheByPluginsDir.get(cacheKeyOf(runtime, net));
  if (!bucket) {
    return { status: "idle", updates: [] };
  }
  return snapshotOf(bucket);
}

/**
 * Ensure a probe is running or return the last ready snapshot.
 * `force` always starts a new run; an in-flight older run is superseded so its
 * finish cannot clobber the newer result (Desktop force while warm still runs).
 * When a run settles, publishes `plugin-inventory/updates-changed` on `bus`
 * (Desktop host SSE / Web host WS → `$dispatch`) so Settings badges refresh
 * without a second force npm view.
 */
export async function ensurePluginUpdateProbe(
  runtime: ProbeRuntime,
  options: {
    readonly force?: boolean;
    readonly entryIds?: readonly string[];
    readonly viewVersion?: NpmViewVersionFn;
    readonly registry?: string;
    readonly proxy?: string;
  } = {},
): Promise<PluginUpdateProbeSnapshot> {
  const net = netFromOptions(options);
  const key = cacheKeyOf(runtime, net);
  let existing = cacheByPluginsDir.get(key);
  if (!existing) {
    existing = { status: "idle", updates: [], runId: 0 };
    cacheByPluginsDir.set(key, existing);
  }
  const bucket = existing;

  if (!options.force && bucket.status === "ready" && !options.entryIds?.length) {
    return snapshotOf(bucket);
  }
  if (!options.force && bucket.inflight) {
    return bucket.inflight;
  }

  const runId = ++bucket.runId;
  // Box so the async body can compare `inflight === this run` without TDZ on const.
  const box: { run?: Promise<PluginUpdateProbeSnapshot> } = {};
  box.run = (async (): Promise<PluginUpdateProbeSnapshot> => {
    bucket.status = "checking";
    delete bucket.error;
    try {
      const updates = await checkFacePluginUpdates(runtime, {
        ...(options.entryIds?.length ? { entryIds: options.entryIds } : {}),
        ...(options.viewVersion ? { viewVersion: options.viewVersion } : {}),
        ...net,
      });
      // Superseded by a newer force/warm — keep that run's writes.
      if (runId !== bucket.runId) {
        return snapshotOf(bucket);
      }
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
      const snap = snapshotOf(bucket);
      publishUpdatesChanged(runtime, snap);
      return snap;
    } catch (err) {
      if (runId !== bucket.runId) {
        return snapshotOf(bucket);
      }
      bucket.status = "error";
      bucket.error = err instanceof Error ? err.message : String(err);
      const snap = snapshotOf(bucket);
      publishUpdatesChanged(runtime, snap);
      return snap;
    } finally {
      if (bucket.inflight === box.run) {
        delete bucket.inflight;
      }
    }
  })();

  bucket.inflight = box.run;
  return box.run;
}

/** Fire-and-forget warm probe after HTTP listen (does not block boot). */
export function schedulePluginUpdateProbeWarm(runtime: ProbeRuntime): void {
  void ensurePluginUpdateProbe(runtime).catch(() => {
    /* warm probe is best-effort — Settings force uses the install-row mirror */
  });
}

/**
 * After install/update succeeds, re-probe the touched ids so Settings badges
 * match the new on-disk versions (warm cache would otherwise keep →same).
 * Settling publishes `plugin-inventory/updates-changed` when `runtime.bus` is set.
 * Returns the probe promise for tests; remotes fire-and-forget with `.catch`.
 */
export function refreshPluginUpdateProbeAfterMutate(
  runtime: ProbeRuntime,
  options: {
    readonly entryIds: readonly string[];
    readonly registry?: string;
    readonly proxy?: string;
    /** Test seam — production remotes omit this and use real `npm view`. */
    readonly viewVersion?: NpmViewVersionFn;
  },
): Promise<PluginUpdateProbeSnapshot | undefined> {
  const ids = options.entryIds.map((id) => id.trim()).filter(Boolean);
  if (ids.length === 0) return Promise.resolve(undefined);
  return ensurePluginUpdateProbe(runtime, {
    force: true,
    entryIds: ids,
    ...(options.viewVersion ? { viewVersion: options.viewVersion } : {}),
    ...netFromOptions(options),
  });
}

/** Test helper — drop in-memory cache. */
export function resetPluginUpdateProbeCacheForTests(): void {
  cacheByPluginsDir.clear();
}
