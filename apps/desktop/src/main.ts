/**
 * Electron process entry ([ADR-0008](../../../docs/adr/0008-desktop-shell-private-host.md)).
 *
 * Wires: single-instance · window lifecycle · private Host on **127.0.0.1
 * loopback** (DSH Desktop posture) · narrow preload · update coordinator.
 * `xrk-app://` remains for splash / static until Host ready.
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
  shell,
} from "electron";
import { registerDesktopIpcHandlers } from "./desktop-ipc.js";
import {
  getDesktopHostPhase,
  isDesktopHostFetchReady,
  markDesktopHostFetchReady,
  publishDesktopHostFailed,
  publishDesktopHostPhase,
  resetDesktopHostFetchReady,
  scheduleDesktopHostFetchAttach,
} from "./desktop-host-attach.js";
import { startDesktopMain } from "./desktop-bootstrap.js";
import {
  attachDesktopNavigationGuard,
  desktopAppIndexUrl,
  desktopLoopbackIndexUrl,
  DESKTOP_PROTOCOL_PRIVILEGES,
  DESKTOP_PROTOCOL_SCHEME,
  handleDesktopProtocolRequest,
} from "./protocol.js";
import {
  DESKTOP_WEB_PREFERENCES,
  DESKTOP_WINDOW_DEFAULTS,
  desktopWindowPlatformOptions,
} from "./window-lifecycle.js";
import { isDesktopUpdateFeedEnabled } from "./app-update-config.js";
import { tryCreateDesktopElectronUpdater } from "./desktop-electron-updater.js";
import {
  installDesktopApplicationMenu,
  publishDesktopUpdateState,
  runDesktopManualUpdateCheck,
} from "./desktop-update-shell.js";
import { resolveDesktopLocale } from "./locale.js";
import { DESKTOP_IPC, type DesktopUpdateState } from "./ipc.js";
import { DesktopUpdateCoordinator } from "./update-coordinator.js";
import {
  DesktopUpdateSchedule,
  resolveDesktopUpdateScheduleConfig,
} from "./update-schedule.js";
import {
  resolveDesktopWebRoot,
  resolveDesktopWindowIconPath,
} from "./web-root.js";
import { DesktopHostProcess } from "./host-process.js";
import {
  resolvePackagedDesktopHostRuntime,
  resolveUnpackagedDesktopHostRuntime,
} from "./host-runtime.js";
import { resolveDesktopHarnessHome } from "./paths.js";

/** Sandboxed preload must be CommonJS (`emit-preload.mjs` → `preload-app.cjs`). */
const PRELOAD_APP = fileURLToPath(
  new URL("./preload-app.cjs", import.meta.url),
);
const DESKTOP_APP_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
/** Product window / dialog title — owned by `locale.ts` dictionaries. */
function desktopWindowTitle(): string {
  return resolveDesktopLocale(app.getLocale()).messages.windowTitle;
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: DESKTOP_PROTOCOL_PRIVILEGES.scheme,
    privileges: { ...DESKTOP_PROTOCOL_PRIVILEGES.privileges },
  },
]);

function createMainBrowserWindow(): BrowserWindow {
  const icon = resolveDesktopWindowIconPath({ platform: process.platform });
  const window = new BrowserWindow({
    ...DESKTOP_WINDOW_DEFAULTS,
    ...desktopWindowPlatformOptions(process.platform),
    title: desktopWindowTitle(),
    ...(icon !== undefined ? { icon } : {}),
    webPreferences: {
      ...DESKTOP_WEB_PREFERENCES,
      preload: PRELOAD_APP,
    },
  });
  window.setTitle(desktopWindowTitle());
  // Deny in-app popups; open https OAuth / verify URLs in the system browser.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https:") || url.startsWith("http:")) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });
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

function loadAllWindowsOnHostOrigin(origin: string): void {
  const url = desktopLoopbackIndexUrl(origin, { platform: process.platform });
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue;
    void window.loadURL(url);
  }
}

let desktopHost: DesktopHostProcess | undefined;
/** Set on will-quit so Host exit does not auto-restart into a dying app. */
let desktopQuitting = false;

async function startDesktopHostCarrier(
  webRoot: string,
  hooks: { readonly onSpawned?: () => void } = {},
): Promise<DesktopHostProcess | undefined> {
  try {
    const runtime = app.isPackaged
      ? resolvePackagedDesktopHostRuntime(process.resourcesPath)
      : resolveUnpackagedDesktopHostRuntime({
          desktopAppRoot: DESKTOP_APP_ROOT,
          webDist: webRoot,
        });
    const xrkHome = resolveDesktopHarnessHome({
      isPackaged: app.isPackaged,
      desktopAppRoot: DESKTOP_APP_ROOT,
    });
    const host = new DesktopHostProcess(runtime.nodeExecutable, runtime.projectDir, {
      entry: runtime.entry,
      env: {
        XRK_HOME: xrkHome,
        XRK_WEB_DIST: runtime.webDist,
        // Bundled harness-cli — Settings plugin mutate never falls back to PATH.
        XRK_HARNESS_BIN: runtime.harnessCliBin,
        XRK_SURFACE: "desktop",
      },
      ...(hooks.onSpawned !== undefined ? { onSpawned: hooks.onSpawned } : {}),
    });
    await host.start();
    desktopHost = host;
    return host;
  } catch (error) {
    console.error(error);
    dialog.showErrorBox(
      desktopWindowTitle(),
      error instanceof Error
        ? `Desktop Host failed to start:\n${error.message}`
        : String(error),
    );
    return undefined;
  }
}

const ownsDesktopInstance = startDesktopMain(app, {
  createWindow: () => createMainBrowserWindow(),
  loadPrimary: (window) => {
    // Splash on custom protocol until Host loopback is ready (DSH: wait then load).
    void (window as BrowserWindow).loadURL(
      desktopAppIndexUrl(DESKTOP_PROTOCOL_SCHEME, { platform: process.platform }),
    );
  },
  getWindowCount: () => BrowserWindow.getAllWindows().length,
  onReady: async () => {
    await bootstrapDesktopUpdates();
    let webRoot: string;
    try {
      webRoot = resolveDesktopWebRoot({
        isPackaged: app.isPackaged,
        appPath: app.getAppPath(),
        resourcesPath: process.resourcesPath,
      });
    } catch (error) {
      console.error(error);
      dialog.showErrorBox(
        desktopWindowTitle(),
        error instanceof Error ? error.message : String(error),
      );
      app.quit();
      return;
    }

    // Keep `xrk-app://` for splash / overlay assets while Host starts.
    const xrkHome = resolveDesktopHarnessHome({
      isPackaged: app.isPackaged,
      desktopAppRoot: DESKTOP_APP_ROOT,
    });
    // Always point at the overlay path — missing dir is a soft 404 until install.
    const overlayRoot = path.join(xrkHome, "plugins", "web");
    protocol.handle(DESKTOP_PROTOCOL_SCHEME, (request) =>
      handleDesktopProtocolRequest(request, {
        webRoot,
        overlayRoot,
      }),
    );

    resetDesktopHostFetchReady();
    const liveWindows = (): Electron.WebContents[] =>
      BrowserWindow.getAllWindows()
        .filter((win) => !win.isDestroyed())
        .map((win) => win.webContents);
    scheduleDesktopHostFetchAttach({
      start: (hooks) => startDesktopHostCarrier(webRoot, hooks),
      onPhase: (phase) => {
        publishDesktopHostPhase(phase, DESKTOP_IPC.hostPhase, liveWindows());
      },
      attach: (host) => {
        const origin = host.faceOrigin;
        if (origin === undefined) {
          publishDesktopHostFailed(
            DESKTOP_IPC.hostFailed,
            liveWindows(),
            "Desktop Host ready without loopback origin",
          );
          return;
        }
        loadAllWindowsOnHostOrigin(origin);
        markDesktopHostFetchReady(
          DESKTOP_IPC.hostReady,
          DESKTOP_IPC.hostPhase,
          liveWindows(),
        );
      },
      detach: () => {
        desktopHost = undefined;
      },
      restartMaxAttempts: 5,
      restartDelayMs: 750,
      shouldAbortRestart: () => desktopQuitting,
      onFailed: (error) => {
        publishDesktopHostFailed(
          DESKTOP_IPC.hostFailed,
          liveWindows(),
          error.message,
        );
      },
    });
  },
});

app.on("will-quit", () => {
  desktopQuitting = true;
  const host = desktopHost;
  desktopHost = undefined;
  resetDesktopHostFetchReady();
  if (host !== undefined) {
    void host.stop().catch((error: unknown) => {
      console.error(error);
    });
  }
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
        const host = desktopHost;
        desktopHost = undefined;
        if (host !== undefined) await host.stop();
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
    windowFromEvent: (event) => {
      const sender = (event as { sender?: Parameters<
        typeof BrowserWindow.fromWebContents
      >[0] } | null)?.sender;
      if (sender === undefined || sender === null) return undefined;
      const win = BrowserWindow.fromWebContents(sender);
      if (win === null || win.isDestroyed()) return undefined;
      return win;
    },
    isHostReady: () => isDesktopHostFetchReady(),
    getHostPhase: () => getDesktopHostPhase(),
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
