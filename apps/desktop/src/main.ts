/**
 * Electron process entry ([ADR-0008](../../../docs/adr/0008-desktop-shell-private-host.md)).
 *
 * Wires: single-instance · window lifecycle · `xrk-app://` · narrow preload (locale / updates).
 * Host Fetch carrier is not fully started; update coordinator skeleton exists
 * but packaged feed wiring remains Not done — see docs/status.md.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, ipcMain, protocol } from "electron";
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

const ownsDesktopInstance = startDesktopMain(app, {
  createWindow: () => createMainBrowserWindow(),
  loadPrimary: (window) => {
    void (window as BrowserWindow).loadURL(desktopAppIndexUrl());
  },
  getWindowCount: () => BrowserWindow.getAllWindows().length,
  onReady: () => {
    registerDesktopIpcHandlers(ipcMain, {
      getLocale: () => app.getLocale(),
    });
    const webRoot = resolveWebRoot();
    protocol.handle(DESKTOP_PROTOCOL_SCHEME, (request) =>
      handleDesktopProtocolRequest(request, { webRoot }),
    );
  },
});

export { ownsDesktopInstance };
