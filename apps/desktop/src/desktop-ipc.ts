/**
 * Main-process IPC handlers for the narrow preload bridge (locale + updates stub).
 * Plugin install IPC awaits install-ready + structured surface wiring.
 */

import type { DesktopLocale } from "./locale.js";
import { resolveDesktopLocale } from "./locale.js";
import { DESKTOP_IPC, type DesktopUpdateState } from "./ipc.js";

export interface DesktopIpcMain {
  handle(
    channel: string,
    listener: (
      event: unknown,
      ...args: unknown[]
    ) => unknown | Promise<unknown>,
  ): void;
}

export interface RegisterDesktopIpcOptions {
  /** Electron `app.getLocale()` (or test stub). */
  getLocale: () => string;
  /**
   * Update check / install. Prefer wiring {@link DesktopUpdateCoordinator}
   * (electron-updater port). Default: idle / not configured.
   */
  checkUpdates?: () => Promise<DesktopUpdateState>;
  installUpdate?: () => Promise<void>;
}

const idleUpdate: DesktopUpdateState = { phase: "idle" };

/** Register locale + update IPC handlers on `ipcMain`. */
export function registerDesktopIpcHandlers(
  ipcMain: DesktopIpcMain,
  options: RegisterDesktopIpcOptions,
): void {
  ipcMain.handle(DESKTOP_IPC.localeGet, (): DesktopLocale => {
    return resolveDesktopLocale(options.getLocale());
  });
  ipcMain.handle(DESKTOP_IPC.updatesCheck, async (): Promise<DesktopUpdateState> => {
    if (options.checkUpdates) return options.checkUpdates();
    return idleUpdate;
  });
  ipcMain.handle(DESKTOP_IPC.updatesInstall, async (): Promise<void> => {
    if (options.installUpdate) {
      await options.installUpdate();
      return;
    }
    throw new Error("xrk desktop: update install is not configured");
  });
}
