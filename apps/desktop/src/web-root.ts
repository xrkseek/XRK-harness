/**
 * Resolve the assembled product Web root for `xrk-app://` (ADR-0008).
 *
 * Packaged: `resources/web` (extraResources; Host Node can read).
 * Unpackaged / `dev:desktop`: `apps/web/dist` (or `XRK_DESKTOP_WEB_ROOT`).
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { resolveDesktopAppRoot } from "./build-paths.js";

/** Env override for the static Web root (`dev:desktop` sets this). */
export const DESKTOP_WEB_ROOT_ENV = "XRK_DESKTOP_WEB_ROOT" as const;

export interface ResolveDesktopWebRootOptions {
  readonly isPackaged: boolean;
  /**
   * Electron `app.getAppPath()` when packaged (asar root or app directory).
   * Ignored when unpackaged unless used as a fallback probe.
   */
  readonly appPath?: string;
  /**
   * Electron `process.resourcesPath` when packaged — prefers `resources/web`
   * (extraResources; Host-readable) over asar `app/web`.
   */
  readonly resourcesPath?: string;
  /** Desktop package root (`apps/desktop`); default from this module. */
  readonly desktopAppRoot?: string;
  readonly env?: NodeJS.ProcessEnv;
}

/**
 * Absolute directory that contains `index.html` for the product shell.
 * Throws when the resolved directory does not contain `index.html`.
 */
export function resolveDesktopWebRoot(
  options: ResolveDesktopWebRootOptions,
): string {
  const env = options.env ?? process.env;
  const fromEnv = env[DESKTOP_WEB_ROOT_ENV]?.trim();
  if (fromEnv) {
    const resolved = path.resolve(fromEnv);
    assertDesktopWebIndex(resolved, `${DESKTOP_WEB_ROOT_ENV}=${resolved}`);
    return resolved;
  }

  if (options.isPackaged) {
    const resourcesPath = options.resourcesPath?.trim();
    if (resourcesPath) {
      const fromResources = path.join(path.resolve(resourcesPath), "web");
      if (existsSync(path.join(fromResources, "index.html"))) {
        return fromResources;
      }
    }
    const appPath = options.appPath?.trim();
    if (!appPath) {
      throw new Error(
        "xrk desktop: packaged Web root requires resourcesPath or app.getAppPath()",
      );
    }
    const packaged = path.join(path.resolve(appPath), "web");
    assertDesktopWebIndex(packaged, packaged);
    return packaged;
  }

  const appRoot = path.resolve(
    options.desktopAppRoot ?? resolveDesktopAppRoot(),
  );
  const unpackaged = path.resolve(appRoot, "..", "web", "dist");
  assertDesktopWebIndex(unpackaged, unpackaged);
  return unpackaged;
}

/** Brand icon directory under `apps/desktop/build` (electron-builder buildResources). */
export function resolveDesktopBuildResourcesDir(
  desktopAppRoot: string = resolveDesktopAppRoot(),
): string {
  return path.join(path.resolve(desktopAppRoot), "build");
}

export interface ResolveDesktopWindowIconPathOptions {
  readonly platform?: NodeJS.Platform;
  readonly desktopAppRoot?: string;
  /** Electron `process.resourcesPath` (optional `icons/` fallback). */
  readonly resourcesPath?: string;
  /** Electron `app.getAppPath()` (asar `build/` next to the package). */
  readonly appPath?: string;
}

/**
 * Window icon path — same shape as git-repository-manager
 * (`path.join(__dirname, 'assets', 'icon.ico')`).
 *
 * Prefer `build/icon.ico` beside the app root (dev monorepo or packaged asar;
 * BrowserWindow accepts an asar string path). Then `resources/icons`.
 * Win32 prefers `.ico`. Do not gate on `nativeImage.createFromPath` (asar → empty).
 */
export function resolveDesktopWindowIconPath(
  options: ResolveDesktopWindowIconPathOptions = {},
): string | undefined {
  const platform = options.platform ?? process.platform;
  const names =
    platform === "win32"
      ? ["icon.ico", "icon.png"]
      : platform === "darwin"
        ? ["icon.png", "icon.icns", "icon.ico"]
        : ["icon.png", "icon.ico"];

  const roots: string[] = [
    resolveDesktopBuildResourcesDir(options.desktopAppRoot),
  ];
  if (options.appPath?.trim()) {
    roots.push(path.join(path.resolve(options.appPath), "build"));
  }
  const resourcesPath =
    options.resourcesPath?.trim() ||
    (typeof process !== "undefined" && typeof process.resourcesPath === "string"
      ? process.resourcesPath
      : undefined);
  if (resourcesPath) {
    roots.push(path.join(path.resolve(resourcesPath), "icons"));
  }

  for (const root of roots) {
    for (const name of names) {
      const candidate = path.join(root, name);
      if (existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

function assertDesktopWebIndex(root: string, label: string): void {
  const index = path.join(root, "index.html");
  if (!existsSync(index)) {
    throw new Error(
      `xrk desktop: product Web index missing at ${label} (expected index.html)`,
    );
  }
}
