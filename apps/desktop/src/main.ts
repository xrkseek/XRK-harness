/**
 * Electron process entry ([ADR-0008](../../../docs/adr/0008-desktop-shell-private-host.md)).
 *
 * Wires: single-instance · window lifecycle · `xrk-app://` · narrow preload (locale / updates)
 * · DesktopUpdateCoordinator + schedule when packaged feed (`app-update.yml`) is present.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  protocol,
} from "electron";
import { registerDesktopIpcHandlers } from "./desktop-ipc.js";
import { startDesktopMain } from "./desktop-bootstrap.js";
import {
  attachDesktopNavigationGuard,
  desktopAppIndexUrl,
  DESKTOP_PROTOCOL_PRIVILEGES,
  DESKTOP_PROTOCOL_SCHEME,
  handleDesktopProtocolRequest,
} from "./protocol.js";
import {
  DESKTOP_WEB_PREFERENCES,
  DESKTOP_WINDOW_DEFAULTS,
} from "./window-lifecycle.js";
import { isDesktopUpdateFeedEnabled } from "./app-update-config.js";
import { tryCreateDesktopElectronUpdater } from "./desktop-electron-updater.js";
import {
  installDesktopApplicationMenu,
  publishDesktopUpdateState,
  runDesktopManualUpdateCheck,
} from "./desktop-update-shell.js";
import { resolveDesktopLocale } from "./locale.js";
import type { DesktopUpdateState } from "./ipc.js";
import { DesktopUpdateCoordinator } from "./update-coordinator.js";
import {
  DesktopUpdateSchedule,
  resolveDesktopUpdateScheduleConfig,
} from "./update-schedule.js";

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PRELOAD_APP = fileURLToPath(new URL("./preload-app.js", import.meta.url));

/** Packaged / monorepo-assembled Web dist (release-matched when packaging lands). */
function resolveWebRoot(): string {
  const fromEnv = process.env.XRK_DESKTOP_WEB_ROOT?.trim();
  if (fromEnv) return path.resolve(fromEnv);
  return path.resolve(APP_ROOT, "..", "web", "dist");
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: DESKTOP_PROTOCOL_PRIVILEGES.scheme,
    privileges: { ...DESKTOP_PROTOCOL_PRIVILEGES.privileges },
  },
]);

function createMainBrowserWindow(): BrowserWindow {
  const window = new BrowserWindow({
    ...DESKTOP_WINDOW_DEFAULTS,
    webPreferences: {
      ...DESKTOP_WEB_PREFERENCES,
      preload: PRELOAD_APP,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  attachDesktopNavigationGuard(window.webContents, DESKTOP_PROTOCOL_SCHEME);
  return window;
}

function focusedOrPrimaryWindow(): BrowserWindow | undefined {
  const focused = BrowserWindow.getFocusedWindow();
  if (focused !== null && focused !== undefined && !focused.isDestroyed()) {
    return focused;
  }
  return BrowserWindow.getAllWindows().find((window) => !window.isDestroyed());
}

function broadcastUpdate(state: DesktopUpdateState): DesktopUpdateState {
  return publishDesktopUpdateState(BrowserWindow.getAllWindows(), state);
}

const ownsDesktopInstance = startDesktopMain(app, {
  createWindow: () => createMainBrowserWindow(),
  loadPrimary: (window) => {
    void (window as BrowserWindow).loadURL(desktopAppIndexUrl());
  },
  getWindowCount: () => BrowserWindow.getAllWindows().length,
  onReady: () => {
    void bootstrapDesktopUpdates();
    const webRoot = resolveWebRoot();
    protocol.handle(DESKTOP_PROTOCOL_SCHEME, (request) =>
      handleDesktopProtocolRequest(request, { webRoot }),
    );
  },
});

async function bootstrapDesktopUpdates(): Promise<void> {
  const feedEnabled = (): boolean =>
    isDesktopUpdateFeedEnabled({
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      forceEnable: process.env.XRK_DESKTOP_UPDATE_FORCE === "1",
    });

  const electronUpdater = await tryCreateDesktopElectronUpdater();
  let coordinator: DesktopUpdateCoordinator | undefined;
  let schedule: DesktopUpdateSchedule | undefined;

  if (electronUpdater !== undefined) {
    coordinator = new DesktopUpdateCoordinator({
      publish: broadcastUpdate,
      updater: electronUpdater,
      enabled: feedEnabled,
      currentVersion: () => app.getVersion(),
      beforeRestart: async () => {
        // Host / framed-pipe shutdown is wired when the private Host is always started.
      },
    });
    if (feedEnabled()) {
      try {
        schedule = new DesktopUpdateSchedule(
          coordinator,
          resolveDesktopUpdateScheduleConfig(process.env),
        );
        void schedule.check(false, true).catch((error: unknown) => {
          console.error(error);
        });
      } catch (error) {
        console.error(error);
      }
    }
  }

  registerDesktopIpcHandlers(ipcMain, {
    getLocale: () => app.getLocale(),
    checkUpdates: async () => {
      if (coordinator === undefined) return { phase: "idle" };
      if (schedule !== undefined) return schedule.check(true, true);
      return coordinator.check(true);
    },
    installUpdate: async () => {
      if (coordinator === undefined) {
        throw new Error("xrk desktop: update install is not configured");
      }
      await coordinator.install();
    },
  });

  installDesktopApplicationMenu({
    menu: Menu,
    getLocale: () => app.getLocale(),
    onCheckUpdates: () => {
      if (coordinator === undefined) return;
      const active = coordinator;
      const activeSchedule = schedule;
      void runDesktopManualUpdateCheck({
        coordinator: active,
        check: () =>
          activeSchedule !== undefined
            ? activeSchedule.check(true, true)
            : active.check(true),
        locale: resolveDesktopLocale(app.getLocale()),
        dialog,
        parentWindow: focusedOrPrimaryWindow(),
      }).catch((error: unknown) => {
        console.error(error);
      });
    },
    platform: process.platform,
  });
}

export { ownsDesktopInstance };
