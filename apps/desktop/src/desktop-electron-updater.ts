/**
 * Wire electron-updater into the DesktopAppUpdater port (ADR-0008).
 * Optional at compile time; Main loads this only when electron-updater resolves.
 */

import type { DesktopAppUpdater } from "./update-coordinator.js";

export interface DesktopElectronUpdaterOptions {
  /** electron-updater channel (matches packaged app-update.yml). */
  readonly channel?: "nightly";
  readonly allowPrerelease?: boolean;
  readonly allowDowngrade?: boolean;
}

/**
 * Configure process-owned `autoUpdater` for full-package Desktop updates.
 * Callers must ensure `electron-updater` is installed (packaged optionalDependency).
 */
export function configureDesktopElectronUpdater(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- electron-updater AppUpdater surface
  updater: any,
  options: DesktopElectronUpdaterOptions = {},
): DesktopAppUpdater {
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
  updater.channel = options.channel ?? "nightly";
  updater.allowPrerelease = options.allowPrerelease ?? true;
  updater.allowDowngrade = options.allowDowngrade ?? false;
  return {
    get autoDownload() {
      return updater.autoDownload as boolean;
    },
    set autoDownload(value: boolean) {
      updater.autoDownload = value;
    },
    get autoInstallOnAppQuit() {
      return updater.autoInstallOnAppQuit as boolean;
    },
    set autoInstallOnAppQuit(value: boolean) {
      updater.autoInstallOnAppQuit = value;
    },
    checkForUpdates: async () => {
      const result = await updater.checkForUpdates();
      if (result === null || result === undefined) return null;
      const version = result.updateInfo?.version;
      return {
        ...(typeof version === "string" ? { updateInfo: { version } } : {}),
        ...(typeof result.isUpdateAvailable === "boolean"
          ? { isUpdateAvailable: result.isUpdateAvailable }
          : {}),
      };
    },
    downloadUpdate: async () => updater.downloadUpdate(),
    quitAndInstall: (isSilent?: boolean, isForceRunAfter?: boolean) => {
      updater.quitAndInstall(isSilent ?? false, isForceRunAfter ?? true);
    },
  };
}

/**
 * Dynamically import electron-updater and return a configured port.
 * Returns undefined when the optional dependency is missing (dev / CI without Electron).
 */
export async function tryCreateDesktopElectronUpdater(
  options: DesktopElectronUpdaterOptions = {},
): Promise<DesktopAppUpdater | undefined> {
  try {
    const mod = (await import("electron-updater")) as {
      autoUpdater?: unknown;
      default?: { autoUpdater?: unknown };
    };
    const autoUpdater = mod.autoUpdater ?? mod.default?.autoUpdater;
    if (autoUpdater === undefined) return undefined;
    return configureDesktopElectronUpdater(autoUpdater, options);
  } catch {
    return undefined;
  }
}
