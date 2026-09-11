/**
 * Filesystem ownership for the Electron-managed desktop installation (ADR-0008).
 * Reuses {@link resolveXrkHome} / {@link XRK_HOME_ENVS} for the shared harness home root.
 */

import path from "node:path";
import { resolveXrkHome, XRK_HOME_ENVS } from "@xrkseek/server-config";
import { DESKTOP_PROFILE_NAME } from "./desktop-bootstrap.js";

/** Build / development scratch under `apps/desktop` (must not be the user `~/.xrk`). */
export const DESKTOP_BUILD_DIR_NAME = ".desktop-build" as const;

/** Stable desktop installation paths under one harness home. */
export interface DesktopPaths {
  readonly root: string;
  readonly profile: string;
  readonly staging: string;
  readonly rollback: string;
  readonly pending: string;
  readonly lock: string;
  readonly pnpm: {
    readonly root: string;
    readonly store: string;
    readonly cache: string;
    readonly state: string;
    readonly config: string;
    readonly home: string;
  };
}

/** Isolated development layout under `apps/desktop/.desktop-build/development`. */
export interface DesktopDevelopmentLayout {
  readonly buildRoot: string;
  readonly developmentRoot: string;
  /** Harness home for unpackaged Electron — not the user’s `~/.xrk` unless env overrides. */
  readonly home: string;
  readonly project: string;
  readonly electronUserData: string;
}

function harnessHomeEnvSet(env: NodeJS.ProcessEnv): boolean {
  for (const key of XRK_HOME_ENVS) {
    const raw = env[key]?.trim();
    if (raw) return true;
  }
  return false;
}

/**
 * Resolve every Electron-owned path under a harness home.
 * Does not create directories or mutate shared product data roots.
 */
export function resolveDesktopPaths(
  xrkHome: string = resolveXrkHome(),
): DesktopPaths {
  const home = path.resolve(xrkHome);
  const root = path.join(home, "desktop");
  const pnpmRoot = path.join(root, "pnpm");
  return {
    root,
    profile: path.join(home, "profiles", DESKTOP_PROFILE_NAME),
    staging: path.join(root, "staging"),
    rollback: path.join(root, "rollback", "profile"),
    pending: path.join(root, "pending.json"),
    lock: path.join(root, "lock"),
    pnpm: {
      root: pnpmRoot,
      store: path.join(pnpmRoot, "store"),
      cache: path.join(pnpmRoot, "cache"),
      state: path.join(pnpmRoot, "state"),
      config: path.join(pnpmRoot, "config"),
      home: path.join(pnpmRoot, "home"),
    },
  };
}

/**
 * Development projection roots under the desktop package.
 * Default home is `.desktop-build/development/home`. Explicit `XRK_HOME` (or aliases) overrides.
 */
export function resolveDesktopDevelopmentLayout(
  desktopAppRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): DesktopDevelopmentLayout {
  const appRoot = path.resolve(desktopAppRoot);
  const buildRoot = path.join(appRoot, DESKTOP_BUILD_DIR_NAME);
  const developmentRoot = path.join(buildRoot, "development");
  const isolatedHome = path.join(developmentRoot, "home");
  return {
    buildRoot,
    developmentRoot,
    home: harnessHomeEnvSet(env) ? resolveXrkHome(env) : isolatedHome,
    project: path.join(developmentRoot, "project"),
    electronUserData: path.join(developmentRoot, "electron-user-data"),
  };
}

/**
 * Harness home for Desktop:
 * - packaged → {@link resolveXrkHome} (user product home)
 * - unpackaged → isolated development home (unless `XRK_HOME` / aliases set)
 */
export function resolveDesktopHarnessHome(options: {
  isPackaged: boolean;
  desktopAppRoot: string;
  env?: NodeJS.ProcessEnv;
}): string {
  const env = options.env ?? process.env;
  if (options.isPackaged) return resolveXrkHome(env);
  return resolveDesktopDevelopmentLayout(options.desktopAppRoot, env).home;
}
