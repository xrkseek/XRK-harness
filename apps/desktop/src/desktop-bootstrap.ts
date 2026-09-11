/**
 * Desktop main bootstrap without importing the `electron` package
 * (injectable for tests; Electron entry wires real `app` / `BrowserWindow`).
 */

import {
  claimDesktopSingleInstance,
} from "./single-instance.js";
import {
  attachDesktopWindowLifecycle,
  bindDesktopMainWindowClosed,
  focusOrRecreatePrimaryWindow,
  showDesktopWindowWhenReady,
  type DesktopShellWindow,
} from "./window-lifecycle.js";

export const DESKTOP_PACKAGE_NAME = "@xrkseek/harness-desktop" as const;

/** Reserved profile directory name under `~/.xrk/profiles/` (ADR-0008). */
export const DESKTOP_PROFILE_NAME = "desktop" as const;

/** Custom protocol scheme (locked): `xrk-app://`. */
export const DESKTOP_PROTOCOL_SCHEME = "xrk-app" as const;

/** Shell / protocol pieces exist; full Host composition still pending. */
export function isDesktopProductReady(): boolean {
  return false;
}

export interface DesktopMainApplication {
  requestSingleInstanceLock(): boolean;
  quit(): void;
  whenReady(): Promise<void>;
  on(
    event: "second-instance" | "activate" | "window-all-closed",
    listener: () => void,
  ): unknown;
}

/**
 * Own the single-instance lock, create the primary window, and focus on later launches.
 * @returns false when this process quit as a secondary instance.
 */
export function startDesktopMain(
  application: DesktopMainApplication,
  options: {
    platform?: NodeJS.Platform;
    createWindow: () => DesktopShellWindow;
    loadPrimary: (window: DesktopShellWindow) => void;
    getWindowCount: () => number;
    /** Runs after `whenReady`, before the first window load (e.g. `protocol.handle`). */
    onReady?: () => void | Promise<void>;
  },
): boolean {
  let mainWindow: DesktopShellWindow | undefined;
  const platform = options.platform ?? process.platform;

  const focusPrimary = (): void => {
    focusOrRecreatePrimaryWindow({
      getMain: () => mainWindow,
      setMain: (next) => {
        mainWindow = next;
      },
      createMainWindow: () => {
        const window = options.createWindow();
        showDesktopWindowWhenReady(window);
        bindDesktopMainWindowClosed(
          window,
          () => mainWindow,
          (next) => {
            mainWindow = next;
          },
        );
        return window;
      },
      loadPrimary: options.loadPrimary,
    });
  };

  const owns = claimDesktopSingleInstance(application, focusPrimary);
  if (!owns) return false;

  void application.whenReady().then(async () => {
    await options.onReady?.();
    focusPrimary();
    attachDesktopWindowLifecycle(application, {
      platform,
      focusPrimary,
      getWindowCount: options.getWindowCount,
    });
  });

  return true;
}
