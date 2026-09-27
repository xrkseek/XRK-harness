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

/**
 * Window / taskbar icon path for the running shell.
 * Prefers `.ico` on Windows, `.icns` on macOS, else `icon.png`.
 */
export function resolveDesktopWindowIconPath(
  options: {
    readonly platform?: NodeJS.Platform;
    readonly desktopAppRoot?: string;
  } = {},
): string | undefined {
  const root = resolveDesktopBuildResourcesDir(options.desktopAppRoot);
  const platform = options.platform ?? process.platform;
  const candidates =
    platform === "win32"
      ? ["icon.ico", "icon.png"]
      : platform === "darwin"
        ? ["icon.icns", "icon.png"]
        : ["icon.png"];
  for (const name of candidates) {
    const candidate = path.join(root, name);
    if (existsSync(candidate)) return candidate;
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
