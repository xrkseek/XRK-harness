/**
 * Packaged Desktop update feed helpers (ADR-0008).
 * Writes `app-update.yml` beside Electron resources so electron-updater can enable.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  renderDesktopAppUpdateYml,
  type DesktopAutoUpdateConfig,
} from "./desktop-auto-update-environment.js";

export const DESKTOP_APP_UPDATE_YML = "app-update.yml" as const;

/** Absolute path for `app-update.yml` under an Electron resources directory. */
export function desktopAppUpdateYmlPath(resourcesDir: string): string {
  return path.join(path.resolve(resourcesDir), DESKTOP_APP_UPDATE_YML);
}

/** Write the generic-provider feed file used by electron-updater. */
export function writeDesktopAppUpdateConfig(
  resourcesDir: string,
  update: DesktopAutoUpdateConfig,
): string {
  const filePath = desktopAppUpdateYmlPath(resourcesDir);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, renderDesktopAppUpdateYml(update), "utf8");
  return filePath;
}

/**
 * Whether this process may talk to the update feed
 * (packaged app + feed file present, or explicit override).
 */
export function isDesktopUpdateFeedEnabled(options: {
  readonly isPackaged: boolean;
  readonly resourcesPath?: string;
  readonly forceEnable?: boolean;
}): boolean {
  if (options.forceEnable === true) return true;
  if (!options.isPackaged) return false;
  const resources = options.resourcesPath?.trim();
  if (resources === undefined || resources.length === 0) return false;
  return existsSync(desktopAppUpdateYmlPath(resources));
}
