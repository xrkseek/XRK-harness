/**
 * Minimal Desktop seed / store strategy (ADR-0008).
 * MVP lands development projection first; offline seed next.
 * Multi-shard store archives and per-object notarization stay deferred.
 */

import path from "node:path";

/** How the Electron shell obtains a runnable Host executable graph. */
export type DesktopInstallMode =
  | "development-projection"
  | "offline-seed";

/**
 * Planned seed root filenames for a future offline installer toolkit.
 * Seed is not a runnable `node_modules` tree.
 */
export const DESKTOP_SEED_LAYOUT = {
  /** Per-file hashes + bound shell / Host versions. */
  integrityFile: "integrity.json",
  /** First-party tarball inventory (CLI family + desktop-host). */
  packageSetFile: "desktop-packages.json",
  /** Directory of local first-party tarballs. */
  packagesDir: "packages",
  /** Lockfile used for offline profile materialization. */
  lockfile: "pnpm-lock.yaml",
  /**
   * MVP store transport: one directory of pnpm content-addressable store bytes,
   * or a single uncompressed `store.tar` — not 16 deterministic shards.
   */
  storeDir: "store",
  storeArchiveFile: "store.tar",
} as const;

/**
 * Explicitly deferred relative to a full upstream-shaped pipeline.
 * Do not implement these in the MVP offline-seed path.
 */
export const DESKTOP_SEED_DEFERRED = [
  "store-archives-16-shards",
  "macos-cas-object-signing-rewrite",
  "differential-shard-reuse",
] as const;

/** Ordered rollout: projection now, offline seed next, shards later. */
export const DESKTOP_SEED_STORE_STRATEGY = {
  /** Current MVP phase for unpackaged / workspace launches. */
  mvpPhase: "development-projection" as const satisfies DesktopInstallMode,
  /** Next product phase for packaged installs (not ready until status flips). */
  nextPhase: "offline-seed" as const satisfies DesktopInstallMode,
  layout: DESKTOP_SEED_LAYOUT,
  deferred: DESKTOP_SEED_DEFERRED,
} as const;

/**
 * Select install mode from package state.
 * Packaged builds are planned as offline-seed; readiness is separate.
 */
export function resolveDesktopInstallMode(options: {
  isPackaged: boolean;
}): DesktopInstallMode {
  return options.isPackaged ? "offline-seed" : "development-projection";
}

/**
 * Offline seed calibrate / merge is not product-ready yet.
 * Keeps status honest until a real seed pipeline lands.
 */
export function isDesktopOfflineSeedReady(): boolean {
  return false;
}

/** Seed toolkit directory inside Electron `resources` (packaged layout draft). */
export function resolveDesktopSeedResourceRoot(resourcesPath: string): string {
  return path.join(path.resolve(resourcesPath), "seed");
}

/**
 * User-side pnpm store that receives merged seed bytes (same as {@link resolveDesktopPaths}.pnpm.store).
 * Documented here so seed calibrate and path ownership stay one story.
 */
export function resolveDesktopUserPnpmStore(desktopPnpmStore: string): string {
  return path.resolve(desktopPnpmStore);
}

/**
 * Whether a deferred capability id is still out of MVP scope.
 */
export function isDesktopSeedCapabilityDeferred(id: string): boolean {
  return (DESKTOP_SEED_DEFERRED as readonly string[]).includes(id);
}
